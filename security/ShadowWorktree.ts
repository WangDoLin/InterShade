import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export interface ShadowWorktreeInfo {
  taskId: string;
  shadowPath: string;
  isGitWorktree: boolean;
  createdAt: number;
}

export class ShadowWorktree {
  /**
   * Create an isolated shadow worktree for safe speculation and reproduction
   */
  static createShadow(workspaceDir: string, taskId: string): ShadowWorktreeInfo {
    const shadowBase = path.join(workspaceDir, '.intershader', 'shadow');
    if (!fs.existsSync(shadowBase)) {
      fs.mkdirSync(shadowBase, { recursive: true });
    }

    const shadowPath = path.join(shadowBase, taskId);
    let isGitWorktree = false;

    const isGit = fs.existsSync(path.join(workspaceDir, '.git'));
    if (isGit) {
      try {
        if (fs.existsSync(shadowPath)) {
          this.removeShadow(shadowPath, workspaceDir);
        }

        execSync(`git worktree add --detach "${shadowPath}" HEAD`, {
          cwd: workspaceDir,
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 8000,
        });
        isGitWorktree = true;
      } catch {
        isGitWorktree = false;
      }
    }

    if (!isGitWorktree && !fs.existsSync(shadowPath)) {
      fs.mkdirSync(shadowPath, { recursive: true });
    }

    return {
      taskId,
      shadowPath,
      isGitWorktree,
      createdAt: Date.now(),
    };
  }

  /**
   * Promote verified file modifications from shadow worktree back to the main workspace
   */
  static promoteToWorkspace(
    shadowDir: string,
    workspaceDir: string,
    relativeFiles: string[]
  ): string[] {
    const promotedFiles: string[] = [];

    for (const rel of relativeFiles) {
      const sourceFile = path.resolve(shadowDir, rel);
      const targetFile = path.resolve(workspaceDir, rel);

      if (fs.existsSync(sourceFile)) {
        const targetDir = path.dirname(targetFile);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.copyFileSync(sourceFile, targetFile);
        promotedFiles.push(rel);
      }
    }

    return promotedFiles;
  }

  /**
   * Safely teardown and remove the shadow worktree
   */
  static removeShadow(shadowDir: string, workspaceDir: string): boolean {
    if (!fs.existsSync(shadowDir)) {
      return true;
    }

    try {
      execSync(`git worktree remove --force "${shadowDir}"`, {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      });
    } catch {
      // Ignore if not a git worktree or already removed
    }

    try {
      if (fs.existsSync(shadowDir)) {
        fs.rmSync(shadowDir, { recursive: true, force: true });
      }
      return true;
    } catch {
      return false;
    }
  }
}
