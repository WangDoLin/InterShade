import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SessionStore } from '../../state/SessionStore.js';
import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { GitSafetyGuard } from '../../security/GitSafetyGuard.js';
import { FileLockRegistry } from '../../engine/swarm/FileLockRegistry.js';
import { SerenaSemanticEngine } from '../../engine/semantic/SerenaSemanticEngine.js';

export class FileWriteTool extends BaseTool<{ filePath: string; content: string; overwrite?: boolean }, string> {
  readonly name = 'file_write';
  readonly description = 'Create a new file or completely overwrite an existing file (automatically creates parent directories) with automated compiler diagnostics.';
  readonly isReadOnly = false;
  readonly isDestructive = true;
  readonly requiresPermission = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Path to the file to create or overwrite'),
    content: z.string().describe('The complete content to write into the file'),
    overwrite: z.boolean().optional().describe('Allow overwriting if the file already exists (default: false)'),
  });

  async execute(
    args: { filePath: string; content: string; overwrite?: boolean },
    context: ToolExecutionContext
  ): Promise<string> {
    if (context.permissionMode === 'plan') {
      throw new Error('[PLAN MODE ACTIVE]: Currently in Plan Mode (Read-Only). File creation/writing is disabled.');
    }

    const resolvedPath = path.isAbsolute(args.filePath) ? args.filePath : path.join(context.cwd, args.filePath);

    const gitSafety = GitSafetyGuard.validateFilePath(resolvedPath, context.cwd);
    if (!gitSafety.isSafe) {
      throw new Error(gitSafety.reason);
    }

    // Concurrency FileLockRegistry lease and scope check
    const leaseCheck = FileLockRegistry.acquireLease(resolvedPath, context.sessionId, 'general');
    if (!leaseCheck.acquired) {
      throw new Error(leaseCheck.reason || `[FILE LOCKED]: File "${args.filePath}" is locked by another active session.`);
    }

    const fileExists = fs.existsSync(resolvedPath);

    if (fileExists && !args.overwrite) {
      throw new Error(
        `[FILE ALREADY EXISTS]: "${args.filePath}" already exists. Pass overwrite: true to overwrite or use file_edit.`
      );
    }

    const dirName = path.dirname(resolvedPath);
    if (!fs.existsSync(dirName)) {
      fs.mkdirSync(dirName, { recursive: true });
    }

    const contentBefore = fileExists ? fs.readFileSync(resolvedPath, 'utf-8') : '';
    const diff = createTwoFilesPatch(
      args.filePath,
      args.filePath,
      contentBefore,
      args.content,
      fileExists ? 'original' : 'empty',
      'created'
    );

    SessionStore.recordFileSnapshot(context.sessionId, args.filePath, contentBefore, args.content, diff);
    fs.writeFileSync(resolvedPath, args.content, 'utf-8');

    const lines = args.content.split(/\r?\n/).length;
    let diagnosticNotice = '';
    const ext = path.extname(resolvedPath).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      try {
        const diags = SerenaSemanticEngine.getDiagnostics(resolvedPath, args.content);
        const errors = diags.filter((d) => d.category === 'error');
        if (errors.length > 0) {
          const topErrors = errors.slice(0, 3);
          diagnosticNotice =
            `\n\n⚠️ [COMPILER DIAGNOSTICS DETECTED]: ${errors.length} error(s) found in ${path.basename(resolvedPath)}:\n` +
            topErrors.map((e) => `  - Line ${e.line}:${e.character} [TS${e.code}] ${e.message}`).join('\n');
        }
      } catch {
        // Silently skip
      }
    }

    return `Wrote ${args.content.length} bytes (${lines} lines) to ${args.filePath}${diagnosticNotice}`;
  }
}
