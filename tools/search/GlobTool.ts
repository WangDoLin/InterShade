import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import fg from 'fast-glob';
import path from 'path';

export class GlobTool extends BaseTool<{ pattern: string; path?: string; maxResults?: number }, string> {
  readonly name = 'glob_find';
  readonly description = 'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.tsx", "*.json").';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    pattern: z.string().describe('Glob pattern to match files (e.g. "**/*.json", "src/**/*.ts")'),
    path: z.string().optional().describe('Root directory to search within (default: current working directory)'),
    maxResults: z.number().optional().describe('Maximum number of file paths to return (default: 100)'),
  });

  async execute(
    args: { pattern: string; path?: string; maxResults?: number },
    context: ToolExecutionContext
  ): Promise<string> {
    const searchCwd = args.path
      ? path.isAbsolute(args.path)
        ? args.path
        : path.join(context.cwd, args.path)
      : context.cwd;

    const maxResults = args.maxResults || 100;

    const files = await fg(args.pattern, {
      cwd: searchCwd,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      onlyFiles: true,
    });

    if (files.length === 0) {
      return `No files matched "${args.pattern}" in "${searchCwd}".`;
    }

    const limitedFiles = files.slice(0, maxResults);
    return `Found ${files.length} files (showing ${limitedFiles.length}):\n${limitedFiles.join('\n')}`;
  }
}
