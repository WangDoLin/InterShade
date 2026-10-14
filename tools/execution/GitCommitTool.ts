import { execSync } from 'child_process';
import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export class GitCommitTool extends BaseTool<
  {
    message: string;
    files?: string[];
    amend?: boolean;
  },
  string
> {
  readonly name = 'git_commit';
  readonly description = 'Create a standardized atomic Git commit with Conventional Commit format (feat, fix, refactor, test, docs, chore). Automatically stages changes and records git commit hash.';
  readonly isReadOnly = false;
  readonly isDestructive = false;

  readonly inputSchema = z.object({
    message: z.string().describe('Conventional Commit message (e.g. "feat(auth): add OAuth2 token refresh support")'),
    files: z.array(z.string()).optional().describe('Specific files to stage and commit. If omitted, all modified tracked and untracked files are staged.'),
    amend: z.boolean().optional().describe('Amend previous commit instead of creating a new one'),
  });

  async execute(
    args: { message: string; files?: string[]; amend?: boolean },
    context: ToolExecutionContext
  ): Promise<string> {
    try {
      // 1. Stage requested files or all changes
      if (args.files && args.files.length > 0) {
        const fileList = args.files.map((f) => `"${f}"`).join(' ');
        execSync(`git add ${fileList}`, {
          cwd: context.cwd,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        execSync('git add -A', {
          cwd: context.cwd,
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }

      // 2. Check if anything is staged
      const stagedDiff = execSync('git diff --cached --name-status', {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (!stagedDiff && !args.amend) {
        return '[Git Commit Notice]: No modified files staged to commit. Working directory is clean.';
      }

      // 3. Formulate commit command
      const sanitizedMessage = args.message.replace(/"/g, '\\"');
      const amendFlag = args.amend ? '--amend --no-edit' : `-m "${sanitizedMessage}"`;
      const commitOutput = execSync(`git commit ${amendFlag}`, {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // 4. Retrieve latest commit hash and stat
      const latestHash = execSync('git rev-parse --short HEAD', {
        cwd: context.cwd,
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      return [
        `[Git Commit Created Successfully]:`,
        `- Commit Hash: ${latestHash}`,
        `- Message: "${args.message}"`,
        `- Staged Files Committed:\n${stagedDiff}`,
        `- Output: ${commitOutput}`,
      ].join('\n');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[Git Commit Error]: Failed to create commit: ${msg}`;
    }
  }
}
