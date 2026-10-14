import type { LocalCommand } from './types.js';
import { SwarmCoordinator } from '../../engine/swarm/SwarmCoordinator.js';
import { FileLockRegistry } from '../../engine/swarm/FileLockRegistry.js';
import { OrcaWorktreeOrchestrator } from '../../engine/orchestration/OrcaWorktreeOrchestrator.js';

let activeCoordinator: SwarmCoordinator | null = null;

export const swarmCommand: LocalCommand = {
  name: 'swarm',
  description: 'Manage concurrent multi-session swarm with role delegation and zero-conflict isolation (/swarm run, /swarm parallel, /swarm status, /swarm merge, /swarm cancel)',
  type: 'local',
  aliases: ['parallel', 'swarms'],
  execute: async (ctx) => {
    const sub = ctx.args[0]?.toLowerCase();

    // 1. /swarm status
    if (sub === 'status' || sub === 'list') {
      const activeLeases = FileLockRegistry.listActiveLeases();
      const currentTasks = activeCoordinator ? activeCoordinator.getSessionManager().getTasks() : [];

      const lines: string[] = ['🐝 InterShader Swarm Status:'];

      if (currentTasks.length === 0) {
        lines.push('  No active swarm sessions currently running.');
      } else {
        lines.push(`  Active Tasks (${currentTasks.length}):`);
        for (const t of currentTasks) {
          lines.push(
            `  - [${t.role.toUpperCase()}] "${t.prompt.slice(0, 40)}..." -> ${t.status.toUpperCase()} (${t.progressPercent}%)`
          );
          if (t.branch) lines.push(`    Worktree: ${t.branch}`);
          if (t.leasedFiles.length > 0) lines.push(`    Locks: ${t.leasedFiles.join(', ')}`);
        }
      }

      lines.push('\n🔒 Active File Leases:');
      if (activeLeases.length === 0) {
        lines.push('  0 files currently leased.');
      } else {
        for (const l of activeLeases) {
          const secLeft = Math.max(0, Math.ceil((l.expiresAt - Date.now()) / 1000));
          lines.push(`  - "${l.filePath}" owned by ${l.role} (Session ${l.sessionId}, ${secLeft}s remaining)`);
        }
      }

      lines.push('\nUsage:');
      lines.push('  /swarm parallel "<prompt 1>" | "<prompt 2>"  - Run multiple prompts concurrently');
      lines.push('  /swarm run <overall project goal>            - Run full automated role swarm');
      lines.push('  /swarm merge                                 - Merge completed worktree branches');
      lines.push('  /swarm cancel                                - Abort running swarm and release locks');

      return lines.join('\n');
    }

    // 2. /swarm cancel
    if (sub === 'cancel' || sub === 'stop') {
      if (activeCoordinator) {
        await activeCoordinator.cancel(ctx.cwd);
        activeCoordinator = null;
        FileLockRegistry.clearAll();
        return 'Swarm execution cancelled. All worker sessions and temporary worktrees cleaned up.';
      }
      FileLockRegistry.clearAll();
      return 'No active swarm was running. Leases cleared.';
    }

    // 3. /swarm merge
    if (sub === 'merge') {
      if (!activeCoordinator) {
        return 'No active swarm tasks to merge.';
      }
      const tasks = activeCoordinator.getSessionManager().getTasks();
      const { SwarmIntegrator } = await import('../../engine/swarm/SwarmIntegrator.js');
      const res = await SwarmIntegrator.mergeSwarmTasks(tasks, 'HEAD', ctx.cwd);
      return res.message;
    }

    // 4. /swarm parallel <prompt1> | <prompt2> or /parallel <prompt1> | <prompt2>
    const isParallelMode = sub === 'parallel' || ctx.args[0]?.includes('|');
    let promptList: string[] = [];

    if (sub === 'parallel') {
      const rest = ctx.args.slice(1).join(' ');
      promptList = rest.split('|').map((p) => p.trim()).filter(Boolean);
    } else if (sub === 'run') {
      const goal = ctx.args.slice(1).join(' ').trim();
      if (!goal) {
        return 'Usage: /swarm run <overall project goal>';
      }
      // Decompose into 2-3 standard roles: Architect/Backend/Frontend/Tester
      promptList = [
        `[Backend Role] Thiết kế và triển khai core services/API cho mục tiêu: ${goal}`,
        `[Frontend Role] Thiết kế và triển khai giao diện components/UI cho mục tiêu: ${goal}`,
        `[Tester Role] Viết unit tests và kịch bản kiểm thử toàn diện cho mục tiêu: ${goal}`,
      ];
    } else if (isParallelMode) {
      const fullArgs = ctx.args.join(' ');
      promptList = fullArgs.split('|').map((p) => p.trim()).filter(Boolean);
    } else {
      return [
        'InterShader Swarm Multi-Session Engine',
        'Commands:',
        '  /swarm parallel <prompt 1> | <prompt 2>   - Run prompts concurrently in isolated worktrees',
        '  /swarm run <goal>                         - Run full multi-agent role delegation',
        '  /swarm status                             - View active agent progress and file locks',
        '  /swarm merge                              - Merge completed worktree branches',
        '  /swarm cancel                             - Terminate all worker sessions',
      ].join('\n');
    }

    if (promptList.length === 0) {
      return 'Please provide at least 1 prompt separated by "|" (e.g. /swarm parallel "prompt 1" | "prompt 2")';
    }

    activeCoordinator = new SwarmCoordinator();
    const promptSpecs = promptList.map((p) => ({ prompt: p }));

    // Non-blocking trigger or await result
    const runPromise = activeCoordinator.runParallel(promptSpecs, ctx.cwd, true);

    const initialReport = [
      `🐝 InterShader Swarm Launched (${promptSpecs.length} Concurrent Sessions):`,
      ...promptSpecs.map((spec, i) => {
        const inferred = SwarmCoordinator.inferRoleAndScope(spec.prompt);
        return `  ${i + 1}. [${inferred.role.toUpperCase()}] "${spec.prompt.slice(0, 60)}..." (Scope: ${inferred.scope.join(', ')})`;
      }),
      '',
      'Isolation: Git Worktree + Exclusive File Lease Registry active.',
      'Monitoring: Run /swarm status to inspect progress in real time.',
    ].join('\n');

    return initialReport;
  },
};
