import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SessionStore } from '../../state/SessionStore.js';
import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { GitSafetyGuard } from '../../security/GitSafetyGuard.js';

export interface FileEditOutput {
  success: boolean;
  filePath: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  message: string;
}

export class FileEditTool extends BaseTool<
  {
    filePath: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
    expectedMtime?: number;
  },
  FileEditOutput
> {
  readonly name = 'file_edit';
  readonly description =
    'Edit the contents of a file by replacing an exact substring (oldString -> newString), with concurrency mtime safety checks and Git diff preview generation.';
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Path to the target file to edit'),
    oldString: z.string().describe('The exact string block to replace'),
    newString: z.string().describe('The new replacement string block'),
    replaceAll: z.boolean().optional().describe('Replace all matching occurrences (default: false)'),
    expectedMtime: z.number().optional().describe('Expected mtime timestamp to prevent dirty writes'),
  });

  async execute(
    args: {
      filePath: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
      expectedMtime?: number;
    },
    context: ToolExecutionContext
  ): Promise<FileEditOutput> {
    if (context.permissionMode === 'plan') {
      throw new Error('[PLAN MODE ACTIVE]: Currently in Plan Mode (Read-Only). File editing is disabled in this mode.');
    }

    const resolvedPath = path.isAbsolute(args.filePath) ? args.filePath : path.join(context.cwd, args.filePath);

    const gitSafety = GitSafetyGuard.validateFilePath(resolvedPath, context.cwd);
    if (!gitSafety.isSafe) {
      throw new Error(gitSafety.reason);
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`[FILE NOT FOUND]: File "${args.filePath}" does not exist at "${resolvedPath}".`);
    }

    const stat = fs.statSync(resolvedPath);

    // 1. Concurrency mtime lock from Claude Code
    if (args.expectedMtime && Math.abs(stat.mtimeMs - args.expectedMtime) > 100) {
      throw new Error(
        `[CONCURRENCY CONFLICT]: File "${args.filePath}" has been modified externally! Please read the file again before applying edits.`
      );
    }

    const contentBefore = fs.readFileSync(resolvedPath, 'utf-8');

    // Normalize line endings for comparison
    const normalizedContent = contentBefore.replace(/\r\n/g, '\n');
    const normalizedOldString = args.oldString.replace(/\r\n/g, '\n');
    const normalizedNewString = args.newString.replace(/\r\n/g, '\n');

    if (!normalizedContent.includes(normalizedOldString)) {
      throw new Error(
        `[MATCH ERROR]: Could not find exact oldString match in "${args.filePath}". Please verify indentation, whitespace, or re-read the file for full surrounding context.`
      );
    }

    const occurrences = normalizedContent.split(normalizedOldString).length - 1;
    if (occurrences > 1 && !args.replaceAll) {
      throw new Error(
        `[AMBIGUITY ERROR]: oldString was found ${occurrences} times in the file. Please provide more surrounding lines of context to make it unique, or specify replaceAll: true.`
      );
    }

    // 2. Perform replacement
    let contentAfter: string;
    if (args.replaceAll) {
      contentAfter = normalizedContent.replaceAll(normalizedOldString, normalizedNewString);
    } else {
      contentAfter = normalizedContent.replace(normalizedOldString, normalizedNewString);
    }

    // Restore CRLF if original file used it
    if (contentBefore.includes('\r\n')) {
      contentAfter = contentAfter.replace(/\n/g, '\r\n');
    }

    // 3. Generate Git Diff Preview
    const diff = createTwoFilesPatch(
      args.filePath,
      args.filePath,
      contentBefore,
      contentAfter,
      'original',
      'modified'
    );

    // 4. Save snapshot in SQLite SessionStore for rollback support
    SessionStore.recordFileSnapshot(context.sessionId, args.filePath, contentBefore, contentAfter, diff);

    // 5. Write file
    fs.writeFileSync(resolvedPath, contentAfter, 'utf-8');

    const linesOld = args.oldString.split('\n').length;
    const linesNew = args.newString.split('\n').length;
    const linesAdded = Math.max(0, linesNew - linesOld);
    const linesRemoved = Math.max(0, linesOld - linesNew);

    return {
      success: true,
      filePath: args.filePath,
      diff,
      linesAdded,
      linesRemoved,
      message: `Updated ${args.filePath} (+${linesAdded}, -${linesRemoved} lines)`,
    };
  }
}
