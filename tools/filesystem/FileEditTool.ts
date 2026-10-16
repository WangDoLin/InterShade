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

export interface FileEditOutput {
  success: boolean;
  filePath: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  message: string;
  diagnostics?: string;
}

/**
 * Whitespace-tolerant line-by-line block matching (Modeled after Aider and Hermes Agent).
 * Returns the exact matched substring in normalizedContent if a unique match is found.
 */
function findFuzzyMatch(content: string, oldString: string): string | null {
  const contentLines = content.split('\n');
  const targetLines = oldString.split('\n');

  const trimmedTargetLines = targetLines.map((l) => l.trim());
  if (trimmedTargetLines.length === 0 || trimmedTargetLines.every((l) => l === '')) {
    return null;
  }

  const matchIndices: number[] = [];
  const targetLen = targetLines.length;

  for (let i = 0; i <= contentLines.length - targetLen; i++) {
    let matched = true;
    for (let j = 0; j < targetLen; j++) {
      if (contentLines[i + j].trim() !== trimmedTargetLines[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matchIndices.push(i);
    }
  }

  if (matchIndices.length === 1) {
    const startIndex = matchIndices[0];
    return contentLines.slice(startIndex, startIndex + targetLen).join('\n');
  }

  return null;
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
    'Edit the contents of a file by replacing an exact or whitespace-tolerant substring (oldString -> newString), with concurrency mtime safety checks, Git diff preview, and automated post-edit compiler diagnostics.';
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Path to the target file to edit'),
    oldString: z.string().describe('The exact or trimmed string block to replace'),
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

    // 0. Concurrency FileLockRegistry lease and scope check
    const leaseCheck = FileLockRegistry.acquireLease(resolvedPath, context.sessionId, 'general');
    if (!leaseCheck.acquired) {
      throw new Error(leaseCheck.reason || `[FILE LOCKED]: File "${args.filePath}" is locked by another active session.`);
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

    let targetToReplace = normalizedOldString;
    let matchType = 'exact';

    if (!normalizedContent.includes(normalizedOldString)) {
      // Fallback: Whitespace-tolerant line-by-line fuzzy match (Aider / Hermes pattern)
      const fuzzyMatch = findFuzzyMatch(normalizedContent, normalizedOldString);
      if (fuzzyMatch) {
        targetToReplace = fuzzyMatch;
        matchType = 'whitespace-tolerant fuzzy match';
      } else {
        throw new Error(
          `[MATCH ERROR]: Could not find exact or whitespace-tolerant match for oldString in "${args.filePath}". Please verify indentation, whitespace, or re-read the file for full surrounding context.`
        );
      }
    }

    const occurrences = normalizedContent.split(targetToReplace).length - 1;
    if (occurrences > 1 && !args.replaceAll) {
      throw new Error(
        `[AMBIGUITY ERROR]: target block was found ${occurrences} times in the file. Please provide more surrounding lines of context to make it unique, or specify replaceAll: true.`
      );
    }

    // 2. Perform replacement
    let contentAfter: string;
    if (args.replaceAll) {
      contentAfter = normalizedContent.replaceAll(targetToReplace, normalizedNewString);
    } else {
      contentAfter = normalizedContent.replace(targetToReplace, normalizedNewString);
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

    const linesOld = targetToReplace.split('\n').length;
    const linesNew = normalizedNewString.split('\n').length;
    const linesAdded = Math.max(0, linesNew - linesOld);
    const linesRemoved = Math.max(0, linesOld - linesNew);

    let diagnosticNotice = '';
    const ext = path.extname(resolvedPath).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      try {
        const diags = SerenaSemanticEngine.getDiagnostics(resolvedPath, contentAfter);
        const errors = diags.filter((d) => d.category === 'error');
        if (errors.length > 0) {
          const topErrors = errors.slice(0, 3);
          diagnosticNotice =
            `\n\n⚠️ [COMPILER DIAGNOSTICS DETECTED]: ${errors.length} error(s) found in ${path.basename(resolvedPath)}:\n` +
            topErrors.map((e) => `  - Line ${e.line}:${e.character} [TS${e.code}] ${e.message}`).join('\n');
        }
      } catch {
        // Silently skip diagnostic failures on external files
      }
    }

    const matchNote = matchType !== 'exact' ? ` (${matchType})` : '';
    const message = `Updated ${args.filePath} (+${linesAdded}, -${linesRemoved} lines)${matchNote}${diagnosticNotice}`;

    return {
      success: true,
      filePath: args.filePath,
      diff,
      linesAdded,
      linesRemoved,
      message,
      diagnostics: diagnosticNotice || undefined,
    };
  }
}
