import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SessionConfig } from '../../types/index.js';
import { QueryEngine } from '../../orchestrator/QueryEngine.js';
import { OrcaWorktreeOrchestrator } from '../orchestration/OrcaWorktreeOrchestrator.js';
import { FileLockRegistry } from './FileLockRegistry.js';
import type { SwarmTask, SwarmProgressEvent, SwarmRole, SwarmSessionStatus } from './SwarmTypes.js';
import { config } from '../../config/index.js';

export interface SpawnWorkerOptions {
  role: SwarmRole;
  prompt: string;
  assignedScope?: string[];
  useWorktree?: boolean;
  baseCwd?: string;
  model?: string;
  provider?: string;
}

export class SwarmSessionManager extends EventEmitter {
  private activeWorkers = new Map<
    string,
    {
      task: SwarmTask;
      queryEngine: QueryEngine;
      worktreePath?: string;
      branch?: string;
    }
  >();

  private isSwarmRunning = false;

  constructor() {
    super();
  }

  /**
   * Check if swarm has active running tasks
   */
  isRunning(): boolean {
    return this.isSwarmRunning;
  }

  /**
   * List all current tasks in the swarm
   */
  getTasks(): SwarmTask[] {
    return Array.from(this.activeWorkers.values()).map((w) => w.task);
  }

  /**
   * Get a specific task by id
   */
  getTask(taskId: string): SwarmTask | undefined {
    return this.activeWorkers.get(taskId)?.task;
  }

  /**
   * Spawn and execute multiple tasks concurrently
   */
  async executeBatch(
    taskSpecs: SpawnWorkerOptions[],
    baseCwd: string = process.cwd()
  ): Promise<SwarmTask[]> {
    this.isSwarmRunning = true;
    const isGit = await OrcaWorktreeOrchestrator.isGitRepository(baseCwd);

    const createdTasks: SwarmTask[] = [];

    for (const spec of taskSpecs) {
      const taskId = `worker-${spec.role}-${randomUUID().slice(0, 6)}`;
      const task: SwarmTask = {
        id: taskId,
        role: spec.role,
        prompt: spec.prompt,
        assignedScope: spec.assignedScope,
        status: 'planning',
        progressPercent: 5,
        leasedFiles: [],
        startedAt: Date.now(),
      };

      let workerCwd = baseCwd;
      let branch: string | undefined;
      let worktreePath: string | undefined;

      // Use Git worktree isolation if repository is under git control and requested
      const shouldIsolate = spec.useWorktree !== false && isGit;
      if (shouldIsolate) {
        try {
          const wt = await OrcaWorktreeOrchestrator.createWorktree(taskId, 'HEAD', baseCwd);
          workerCwd = wt.worktreePath;
          worktreePath = wt.worktreePath;
          branch = wt.branch;
          task.worktreePath = worktreePath;
          task.branch = branch;
        } catch (err: unknown) {
          // If worktree creation fails, fallback to shared cwd with scope checking
          workerCwd = baseCwd;
        }
      }

      // Register scope boundaries with FileLockRegistry
      if (spec.assignedScope && spec.assignedScope.length > 0) {
        FileLockRegistry.setSessionScope(taskId, spec.assignedScope);
      }

      const sessionConfig: SessionConfig = {
        sessionId: taskId,
        resumeSession: false,
        provider: spec.provider || config.defaultProvider,
        model: spec.model || config.defaultModel,
        cwd: workerCwd,
        maxTokens: config.maxContextTokens,
        maxTurns: 25,
        permissionMode: 'bypassPermissions', // Autonomous swarm workers run in non-interactive bypass
        proofMode: false,
      };

      const queryEngine = new QueryEngine(sessionConfig);

      // Wire progress and tool event handlers
      this.attachWorkerEvents(taskId, task, queryEngine);

      this.activeWorkers.set(taskId, {
        task,
        queryEngine,
        worktreePath,
        branch,
      });

      createdTasks.push(task);
    }

    this.emitProgress();

    // Execute all worker sessions concurrently in parallel!
    const promises = Array.from(this.activeWorkers.entries()).map(
      async ([taskId, worker]) => {
        worker.task.status = 'running';
        worker.task.progressPercent = 15;
        this.emitProgress();

        try {
          const result = await worker.queryEngine.executeUserPrompt(worker.task.prompt);
          worker.task.status = 'completed';
          worker.task.progressPercent = 100;
          worker.task.resultSummary = typeof result === 'string' ? result.slice(0, 500) : 'Task completed successfully.';
          worker.task.completedAt = Date.now();
        } catch (err: unknown) {
          worker.task.status = 'failed';
          worker.task.errorMessage = err instanceof Error ? err.message : String(err);
          worker.task.completedAt = Date.now();
        } finally {
          FileLockRegistry.releaseAllLeasesForSession(taskId);
          this.emitProgress();
        }
      }
    );

    await Promise.allSettled(promises);
    this.isSwarmRunning = false;
    this.emitProgress();

    return this.getTasks();
  }

  /**
   * Terminate and clean up all worker sessions and temporary worktrees
   */
  async cleanup(baseCwd: string = process.cwd()): Promise<void> {
    for (const [taskId, worker] of this.activeWorkers.entries()) {
      FileLockRegistry.releaseAllLeasesForSession(taskId);
      if (worker.worktreePath) {
        try {
          await OrcaWorktreeOrchestrator.cleanupWorktree(taskId, true, baseCwd);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    this.activeWorkers.clear();
    this.isSwarmRunning = false;
    this.emitProgress();
  }

  private attachWorkerEvents(taskId: string, task: SwarmTask, queryEngine: QueryEngine): void {
    queryEngine.on('tool_start', (data: { name: string; toolCall?: { name: string; arguments?: Record<string, unknown> } }) => {
      task.currentTool = data.name;
      task.progressPercent = Math.min(85, task.progressPercent + 10);

      // Track active file leases
      const args = data.toolCall?.arguments;
      if (args && typeof args.filePath === 'string') {
        const filePath = String(args.filePath);
        if (!task.leasedFiles.includes(filePath)) {
          task.leasedFiles.push(filePath);
        }
      }

      this.emitProgress();
    });

    queryEngine.on('tool_done', () => {
      task.progressPercent = Math.min(90, task.progressPercent + 5);
      this.emitProgress();
    });

    queryEngine.on('error', (err: Error) => {
      task.errorMessage = err.message;
      this.emitProgress();
    });
  }

  private emitProgress(): void {
    const tasks = this.getTasks();
    const activeCount = tasks.filter((t) => t.status === 'running' || t.status === 'planning' || t.status === 'verifying').length;
    const completedCount = tasks.filter((t) => t.status === 'completed').length;
    const failedCount = tasks.filter((t) => t.status === 'failed').length;

    let overallStatus: SwarmProgressEvent['overallStatus'] = 'running';
    if (activeCount === 0) {
      if (failedCount > 0 && completedCount > 0) {
        overallStatus = 'partial_failure';
      } else if (failedCount > 0 && completedCount === 0) {
        overallStatus = 'failed';
      } else {
        overallStatus = 'completed';
      }
    }

    const event: SwarmProgressEvent = {
      swarmId: 'swarm-active',
      tasks,
      overallStatus,
      activeCount,
      completedCount,
      totalCount: tasks.length,
    };

    this.emit('progress', event);
  }
}
