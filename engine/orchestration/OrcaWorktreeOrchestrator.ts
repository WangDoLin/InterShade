import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface OrcaWorktreeItem {
  worktreePath: string;
  headCommit: string;
  branch: string;
  isBare: boolean;
  isInterShadeManaged: boolean;
}

export interface OrcaWorktreeDiffSummary {
  worktreeId: string;
  branch: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  rawDiff: string;
}

export interface OrcaComparisonResult {
  baseBranch: string;
  worktrees: OrcaWorktreeDiffSummary[];
  recommendedWinner?: string;
}

export class OrcaWorktreeOrchestrator {
  private static readonly WORKTREE_BASE_DIR = '.intershade/worktrees';

  private static getGitDir(cwd: string = process.cwd()): string {
    return path.resolve(cwd);
  }

  private static getWorktreePath(worktreeId: string, cwd: string = process.cwd()): string {
    const safeId = worktreeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.resolve(cwd, OrcaWorktreeOrchestrator.WORKTREE_BASE_DIR, safeId);
  }

  /**
   * Ensure .intershade/worktrees directory exists and is added to .gitignore
   */
  static ensureWorktreeDirectory(cwd: string = process.cwd()): string {
    const targetDir = path.resolve(cwd, OrcaWorktreeOrchestrator.WORKTREE_BASE_DIR);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const gitignorePath = path.resolve(cwd, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      if (!gitignore.includes('.intershade/')) {
        fs.appendFileSync(gitignorePath, '\n# InterShader Worktrees & Cache\n.intershade/\n');
      }
    }

    return targetDir;
  }

  /**
   * Check if current working directory is inside a valid git repository
   */
  static async isGitRepository(cwd: string = process.cwd()): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create an isolated git worktree for an agent or model exploration branch
   */
  static async createWorktree(
    worktreeId: string,
    baseBranch: string = 'HEAD',
    cwd: string = process.cwd()
  ): Promise<{ worktreePath: string; branch: string }> {
    const isGit = await OrcaWorktreeOrchestrator.isGitRepository(cwd);
    if (!isGit) {
      throw new Error(
        `InterShader worktree orchestration requires a git repository. '${cwd}' is not inside a git repository.`
      );
    }

    OrcaWorktreeOrchestrator.ensureWorktreeDirectory(cwd);
    const safeId = worktreeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branch = `intershade-wt-${safeId}`;
    const wtPath = OrcaWorktreeOrchestrator.getWorktreePath(safeId, cwd);

    // If worktree directory already exists, clean it up first
    if (fs.existsSync(wtPath)) {
      await OrcaWorktreeOrchestrator.cleanupWorktree(safeId, true, cwd).catch(() => {});
    }

    // git worktree add -b <branch> <path> <baseBranch>
    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branch, wtPath, baseBranch], { cwd });
    } catch (err: unknown) {
      // If branch already exists, try adding without -b
      try {
        await execFileAsync('git', ['worktree', 'add', wtPath, branch], { cwd });
      } catch (subErr: unknown) {
        throw new Error(
          `Failed to create git worktree: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { worktreePath: wtPath, branch };
  }

  /**
   * List all active git worktrees and detect InterShade-managed ones
   */
  static async listWorktrees(cwd: string = process.cwd()): Promise<OrcaWorktreeItem[]> {
    const isGit = await OrcaWorktreeOrchestrator.isGitRepository(cwd);
    if (!isGit) {
      return [];
    }

    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd });
      const items: OrcaWorktreeItem[] = [];

      const blocks = stdout.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        let wtPath = '';
        let headCommit = '';
        let branch = '';
        let isBare = false;

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            wtPath = line.substring(9).trim();
          } else if (line.startsWith('HEAD ')) {
            headCommit = line.substring(5).trim();
          } else if (line.startsWith('branch ')) {
            branch = line.substring(7).trim().replace('refs/heads/', '');
          } else if (line === 'bare') {
            isBare = true;
          }
        }

        if (wtPath) {
          const isManaged = wtPath.includes(OrcaWorktreeOrchestrator.WORKTREE_BASE_DIR) ||
                            branch.startsWith('intershade-wt-');
          items.push({
            worktreePath: wtPath,
            headCommit,
            branch,
            isBare,
            isInterShadeManaged: isManaged,
          });
        }
      }

      return items;
    } catch (err: unknown) {
      throw new Error(`Failed to list git worktrees: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Get diff of changes made within a specific worktree against base branch
   */
  static async getWorktreeDiff(
    worktreeId: string,
    baseBranch: string = 'HEAD',
    cwd: string = process.cwd()
  ): Promise<string> {
    const wtPath = OrcaWorktreeOrchestrator.getWorktreePath(worktreeId, cwd);
    if (!fs.existsSync(wtPath)) {
      throw new Error(`Worktree '${worktreeId}' not found at path: ${wtPath}`);
    }

    try {
      const { stdout } = await execFileAsync('git', ['diff', baseBranch], { cwd: wtPath });
      return stdout;
    } catch (err: unknown) {
      throw new Error(`Failed to inspect diff for worktree: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Compare diff stats across multiple candidate worktrees
   */
  static async compareWorktrees(
    baseBranch: string = 'HEAD',
    worktreeIds: string[],
    cwd: string = process.cwd()
  ): Promise<OrcaComparisonResult> {
    const summaries: OrcaWorktreeDiffSummary[] = [];

    for (const id of worktreeIds) {
      const wtPath = OrcaWorktreeOrchestrator.getWorktreePath(id, cwd);
      if (!fs.existsSync(wtPath)) continue;

      try {
        const { stdout: diffStat } = await execFileAsync(
          'git',
          ['diff', '--stat', baseBranch],
          { cwd: wtPath }
        );
        const { stdout: rawDiff } = await execFileAsync(
          'git',
          ['diff', baseBranch],
          { cwd: wtPath }
        );

        // Parse stat (e.g., "3 files changed, 45 insertions(+), 12 deletions(-)")
        let filesChanged = 0;
        let insertions = 0;
        let deletions = 0;

        const statMatch = diffStat.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/);
        if (statMatch) {
          filesChanged = parseInt(statMatch[1] || '0', 10);
          insertions = parseInt(statMatch[2] || '0', 10);
          deletions = parseInt(statMatch[3] || '0', 10);
        }

        summaries.push({
          worktreeId: id,
          branch: `intershade-wt-${id}`,
          filesChanged,
          insertions,
          deletions,
          rawDiff,
        });
      } catch {
        // Skip errored worktree
      }
    }

    // Heuristic: Candidate with cleanest diff and active changes
    const active = summaries.filter((s) => s.filesChanged > 0);
    const recommendedWinner = active.length > 0 ? active[0].worktreeId : summaries[0]?.worktreeId;

    return {
      baseBranch,
      worktrees: summaries,
      recommendedWinner,
    };
  }

  /**
   * Merge the winning worktree branch into the target branch
   */
  static async mergeWinner(
    winnerWorktreeId: string,
    targetBranch: string = 'main',
    cwd: string = process.cwd()
  ): Promise<{ success: boolean; message: string }> {
    const safeId = winnerWorktreeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branch = `intershade-wt-${safeId}`;

    try {
      // 1. In main repository, merge the branch
      const commitMsg = `chore(intershade): merge winning solution from worktree ${safeId}`;
      await execFileAsync('git', ['merge', '--no-ff', branch, '-m', commitMsg], { cwd });

      // 2. Cleanup worktree
      await OrcaWorktreeOrchestrator.cleanupWorktree(safeId, true, cwd);

      return {
        success: true,
        message: `Successfully merged winning branch '${branch}' into '${targetBranch}'. Worktree cleaned up.`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Safely remove a worktree and prune the temporary git branch
   */
  static async cleanupWorktree(
    worktreeId: string,
    deleteBranch: boolean = true,
    cwd: string = process.cwd()
  ): Promise<void> {
    const safeId = worktreeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const wtPath = OrcaWorktreeOrchestrator.getWorktreePath(safeId, cwd);
    const branch = `intershade-wt-${safeId}`;

    try {
      if (fs.existsSync(wtPath)) {
        await execFileAsync('git', ['worktree', 'remove', '--force', wtPath], { cwd });
      }
    } catch {
      // Fallback: prune and manual directory removal if needed
      await execFileAsync('git', ['worktree', 'prune'], { cwd }).catch(() => {});
      if (fs.existsSync(wtPath)) {
        fs.rmSync(wtPath, { recursive: true, force: true });
      }
    }

    if (deleteBranch) {
      await execFileAsync('git', ['branch', '-D', branch], { cwd }).catch(() => {});
    }
  }
}
