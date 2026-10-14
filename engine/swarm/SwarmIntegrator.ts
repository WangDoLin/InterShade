import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { OrcaWorktreeOrchestrator } from '../orchestration/OrcaWorktreeOrchestrator.js';
import type { SwarmTask, SwarmMergeResult } from './SwarmTypes.js';

const execFileAsync = promisify(execFile);

export class SwarmIntegrator {
  /**
   * Integrate and merge completed worker branches into base workspace branch
   */
  static async mergeSwarmTasks(
    tasks: SwarmTask[],
    baseBranch: string = 'HEAD',
    cwd: string = process.cwd()
  ): Promise<SwarmMergeResult> {
    const isGit = await OrcaWorktreeOrchestrator.isGitRepository(cwd);
    if (!isGit) {
      return {
        success: true,
        mergedBranches: [],
        failedBranches: [],
        verificationPassed: true,
        message: 'No git repository detected. Changes applied directly in shared workspace.',
      };
    }

    const completedWithBranch = tasks.filter(
      (t) => t.status === 'completed' && t.branch && t.worktreePath
    );

    if (completedWithBranch.length === 0) {
      return {
        success: true,
        mergedBranches: [],
        failedBranches: [],
        verificationPassed: true,
        message: 'No worktree branches to merge.',
      };
    }

    // 1. Pre-merge collision check: Inspect changed files across candidate worktrees
    const branchFilesMap = new Map<string, string[]>();
    for (const t of completedWithBranch) {
      if (!t.worktreePath) continue;
      try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', baseBranch], {
          cwd: t.worktreePath,
        });
        const files = stdout.split('\n').map((f) => f.trim()).filter(Boolean);
        branchFilesMap.set(t.branch!, files);
      } catch {
        branchFilesMap.set(t.branch!, []);
      }
    }

    // Check for overlapping file modifications across branches
    const allModifiedFiles = new Map<string, string>(); // file -> branch
    const detectedCollisions: Array<{ file: string; branches: string[] }> = [];

    for (const [branch, files] of branchFilesMap.entries()) {
      for (const file of files) {
        if (allModifiedFiles.has(file)) {
          const firstBranch = allModifiedFiles.get(file)!;
          detectedCollisions.push({
            file,
            branches: [firstBranch, branch],
          });
        } else {
          allModifiedFiles.set(file, branch);
        }
      }
    }

    if (detectedCollisions.length > 0) {
      const collisionSummary = detectedCollisions
        .map((c) => `File "${c.file}" modified by both [${c.branches.join(', ')}]`)
        .join('; ');

      return {
        success: false,
        mergedBranches: [],
        failedBranches: completedWithBranch.map((t) => ({ branch: t.branch!, reason: 'Collision detected' })),
        verificationPassed: false,
        message: `[MERGE BLOCKED]: Overlapping file modifications detected across worker sessions: ${collisionSummary}. Manual resolution required.`,
      };
    }

    // 2. Perform clean sequential merge
    const mergedBranches: string[] = [];
    const failedBranches: Array<{ branch: string; reason: string }> = [];

    for (const t of completedWithBranch) {
      const branch = t.branch!;
      try {
        const commitMsg = `feat(swarm): integrate changes from role "${t.role}" (${t.id})`;
        await execFileAsync('git', ['merge', '--no-ff', branch, '-m', commitMsg], { cwd });
        mergedBranches.push(branch);

        // Cleanup temporary worktree
        await OrcaWorktreeOrchestrator.cleanupWorktree(t.id, true, cwd).catch(() => {});
      } catch (err: unknown) {
        failedBranches.push({
          branch,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const allSuccess = failedBranches.length === 0;

    return {
      success: allSuccess,
      mergedBranches,
      failedBranches,
      verificationPassed: allSuccess,
      message: allSuccess
        ? `Successfully merged ${mergedBranches.length} worker branch(es) cleanly into workspace.`
        : `Partial merge completed. Merged: [${mergedBranches.join(', ')}]. Failed: [${failedBranches.map((f) => f.branch).join(', ')}]`,
    };
  }
}
