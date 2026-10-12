import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export class GrepTool extends BaseTool<
  { query: string; path?: string; caseInsensitive?: boolean; maxResults?: number },
  string
> {
  readonly name = 'grep_search';
  readonly description = 'Search for text or regex patterns across the codebase using ripgrep (with pure Node fallback).';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    query: z.string().describe('Search query or regular expression pattern'),
    path: z.string().optional().describe('Directory or file path to search within (default: current working directory)'),
    caseInsensitive: z.boolean().optional().describe('Case-insensitive search (default: false)'),
    maxResults: z.number().optional().describe('Maximum number of matching lines to return (default: 50)'),
  });

  async execute(
    args: { query: string; path?: string; caseInsensitive?: boolean; maxResults?: number },
    context: ToolExecutionContext
  ): Promise<string> {
    const searchPath = args.path
      ? path.isAbsolute(args.path)
        ? args.path
        : path.join(context.cwd, args.path)
      : context.cwd;

    const maxResults = args.maxResults || 50;
    const caseFlag = args.caseInsensitive ? '-i' : '';

    try {
      const escapedQuery = args.query.replace(/"/g, '\\"');
      const cmd = `rg -n ${caseFlag} --max-count ${maxResults} --no-heading "${escapedQuery}" "${searchPath}"`;
      const output = execSync(cmd, {
        cwd: context.cwd,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const lines = output.trim().split('\n');
      return `Found ${lines.length} matches:\n${lines.slice(0, maxResults).join('\n')}`;
    } catch (rgError: unknown) {
      const err = rgError as { status?: number; stdout?: string; stderr?: Buffer | string; message?: string };
      const errStr = `${err.message || ''} ${err.stderr ? err.stderr.toString() : ''}`;
      const isCommandMissing = /not recognized|not found|ENOENT/i.test(errStr);
      if (isCommandMissing) {
        return this.fallbackSearch(searchPath, args.query, Boolean(args.caseInsensitive), maxResults);
      }
      if (err.status === 1) {
        return `No matches found for "${args.query}".`;
      }
      return this.fallbackSearch(searchPath, args.query, Boolean(args.caseInsensitive), maxResults);
    }
  }

  private fallbackSearch(
    rootPath: string,
    query: string,
    caseInsensitive: boolean,
    maxResults: number
  ): string {
    const results: string[] = [];
    const flags = caseInsensitive ? 'i' : '';
    let regex: RegExp;
    try {
      regex = new RegExp(query, flags);
    } catch {
      regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    }

    const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.intershade', '.intershader', '.next', 'build', 'out']);

    const scanDir = (dir: string) => {
      if (results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.isDirectory()) {
          if (!IGNORE_DIRS.has(entry.name)) {
            scanDir(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const filePath = path.join(dir, entry.name);
          try {
            const stat = fs.statSync(filePath);
            if (stat.size > 2 * 1024 * 1024) continue;
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                const relPath = path.relative(rootPath, filePath);
                results.push(`${relPath}:${i + 1}:${lines[i].trim()}`);
                if (results.length >= maxResults) break;
              }
            }
          } catch {}
        }
      }
    };

    if (fs.existsSync(rootPath)) {
      if (fs.statSync(rootPath).isFile()) {
        try {
          const content = fs.readFileSync(rootPath, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${rootPath}:${i + 1}:${lines[i].trim()}`);
              if (results.length >= maxResults) break;
            }
          }
        } catch {}
      } else {
        scanDir(rootPath);
      }
    }

    if (results.length === 0) {
      return `No matches found for "${query}".`;
    }
    return `Found ${results.length} matches:\n${results.join('\n')}`;
  }
}
