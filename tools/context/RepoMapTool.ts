import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { AstSkeletonExtractor } from '../../context/AstSkeletonExtractor.js';

export class RepoMapTool extends BaseTool<
  {
    subDir?: string;
    maxFiles?: number;
  },
  string
> {
  readonly name = 'repo_map';
  readonly description = 'Generates a compact, high-density AST structural map of the repository showing symbols, classes, interfaces, and function signatures. Eliminates blind guessing across the workspace.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    subDir: z.string().optional().describe('Sub-directory to focus the map on (defaults to entire repository)'),
    maxFiles: z.number().optional().describe('Maximum number of key source files to include (default: 20)'),
  });

  async execute(
    args: { subDir?: string; maxFiles?: number },
    context: ToolExecutionContext
  ): Promise<string> {
    const rootDir = args.subDir ? path.resolve(context.cwd, args.subDir) : context.cwd;
    const maxFiles = args.maxFiles || 20;

    const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.intershade', 'coverage', '.cache']);

    const discoveredFiles: string[] = [];

    const scanDirectory = (current: string, depth = 0) => {
      if (depth > 6 || discoveredFiles.length >= maxFiles * 2) return;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') && entry.name !== '.env') continue;
          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name)) {
              scanDirectory(path.join(current, entry.name), depth + 1);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (codeExtensions.has(ext)) {
              discoveredFiles.push(path.join(current, entry.name));
            }
          }
        }
      } catch {
        // ignore unreadable dirs
      }
    };

    scanDirectory(rootDir);

    if (discoveredFiles.length === 0) {
      return `[Repo Map Notice]: No source code files found in directory: ${rootDir}`;
    }

    const selectedFiles = discoveredFiles.slice(0, maxFiles);
    const mapEntries: string[] = [
      `# Repository AST Structural Architecture Map (${selectedFiles.length} files indexed):`,
      `Root: ${rootDir}\n`
    ];

    for (const filePath of selectedFiles) {
      const relPath = path.relative(context.cwd, filePath);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Extract AST skeleton
        const skeleton = AstSkeletonExtractor.extract(filePath, content);
        
        // Compact the skeleton further for the map
        const summaryLines = skeleton.skeletonContent
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => {
            const trimmed = l.trim();
            return (
              trimmed.startsWith('export ') ||
              trimmed.startsWith('interface ') ||
              trimmed.startsWith('class ') ||
              trimmed.startsWith('type ') ||
              trimmed.startsWith('def ') ||
              trimmed.startsWith('fn ') ||
              trimmed.startsWith('func ') ||
              trimmed.startsWith('public ') ||
              trimmed.startsWith('protected ')
            );
          })
          .slice(0, 15);

        if (summaryLines.length > 0) {
          mapEntries.push(`### \`${relPath}\` (${skeleton.language}):`);
          mapEntries.push('```ts');
          mapEntries.push(summaryLines.join('\n'));
          mapEntries.push('```\n');
        } else {
          mapEntries.push(`- \`${relPath}\` (${skeleton.language})`);
        }
      } catch {
        mapEntries.push(`- \`${relPath}\``);
      }
    }

    return mapEntries.join('\n');
  }
}
