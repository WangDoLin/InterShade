import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { OrcaWorktreeOrchestrator } from '../../engine/orchestration/OrcaWorktreeOrchestrator.js';

export class OrcaWorktreeCreateTool extends BaseTool<{ worktreeId: string; baseBranch?: string }, string> {
  readonly name = 'orca_worktree_create';
  readonly description = 'Create an isolated git worktree for parallel agent exploration or model comparison without altering active files.';
  readonly isDestructive = false;

  readonly inputSchema = z.object({
    worktreeId: z.string().describe('Unique identifier or slug for the worktree'),
    baseBranch: z.string().optional().describe('Git branch or commit to fork from (default: HEAD)'),
  });

  async execute(args: { worktreeId: string; baseBranch?: string }, context: ToolExecutionContext): Promise<string> {
    const res = await OrcaWorktreeOrchestrator.createWorktree(args.worktreeId, args.baseBranch || 'HEAD', context.cwd);
    return `Worktree Created\nID:     ${args.worktreeId}\nPath:   ${res.worktreePath}\nBranch: ${res.branch}`;
  }
}

export class OrcaWorktreeListTool extends BaseTool<Record<string, never>, string> {
  readonly name = 'orca_worktree_list';
  readonly description = 'List all active git worktrees, identifying InterShade-managed isolated worktrees.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({});

  async execute(_args: Record<string, never>, context: ToolExecutionContext): Promise<string> {
    const items = await OrcaWorktreeOrchestrator.listWorktrees(context.cwd);
    if (items.length === 0) {
      return 'No git worktrees found.';
    }

    const lines: string[] = [
      'Active Git Worktrees',
      `${'BRANCH'.padEnd(25)} ${'MANAGED'.padEnd(10)} ${'HEAD'.padEnd(10)} ${'PATH'}`,
      '-'.repeat(80),
    ];

    for (const item of items) {
      const managed = item.isInterShadeManaged ? 'YES' : 'NO';
      lines.push(`${item.branch.padEnd(25)} ${managed.padEnd(10)} ${item.headCommit.substring(0, 8).padEnd(10)} ${item.worktreePath}`);
    }

    return lines.join('\n');
  }
}

export class OrcaWorktreeDiffTool extends BaseTool<{ worktreeId: string; baseBranch?: string }, string> {
  readonly name = 'orca_worktree_diff';
  readonly description = 'Inspect the git diff of changes made within an isolated worktree against the base branch.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    worktreeId: z.string().describe('ID of the worktree to inspect diff for'),
    baseBranch: z.string().optional().describe('Base branch to compare against (default: HEAD)'),
  });

  async execute(args: { worktreeId: string; baseBranch?: string }, context: ToolExecutionContext): Promise<string> {
    const diff = await OrcaWorktreeOrchestrator.getWorktreeDiff(args.worktreeId, args.baseBranch || 'HEAD', context.cwd);
    if (!diff.trim()) {
      return `No changes in worktree '${args.worktreeId}' compared to ${args.baseBranch || 'HEAD'}.`;
    }
    return `Worktree Diff: ${args.worktreeId}\n${diff}`;
  }
}

export class OrcaWorktreeCleanupTool extends BaseTool<{ worktreeId: string; deleteBranch?: boolean }, string> {
  readonly name = 'orca_worktree_cleanup';
  readonly description = 'Remove an isolated worktree directory and prune its temporary branch.';
  readonly isDestructive = true;

  readonly inputSchema = z.object({
    worktreeId: z.string().describe('ID of the worktree to clean up'),
    deleteBranch: z.boolean().optional().describe('Whether to also delete the git branch (default: true)'),
  });

  async execute(args: { worktreeId: string; deleteBranch?: boolean }, context: ToolExecutionContext): Promise<string> {
    await OrcaWorktreeOrchestrator.cleanupWorktree(args.worktreeId, args.deleteBranch !== false, context.cwd);
    return `Worktree '${args.worktreeId}' successfully cleaned up.`;
  }
}
