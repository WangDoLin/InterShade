import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import ignore from 'ignore';

const DEFAULT_MAX_RESULTS = 50;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB limit to prevent memory bloat
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB process stdout buffer
const FILE_BATCH_SIZE = 32; // Batch concurrency for fast async search

const IGNORED_DIRECTORIES = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '.cache/**',
  '.turbo/**',
  'target/**',
  'vendor/**',
  '.intershade/**',
  '.intershader/**',
  '.idea/**',
  '.vscode/**',
  '.vs/**',
  'bin/**',
  'obj/**',
  'tmp/**',
  'temp/**',
  'logs/**',
  '__pycache__/**',
  '.venv/**',
  'env/**',
  'venv/**',
];

const IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.turbo',
  'target',
  'vendor',
  '.intershade',
  '.intershader',
  '.idea',
  '.vscode',
  '.vs',
  'bin',
  'obj',
  'tmp',
  'temp',
  'logs',
  '__pycache__',
  '.venv',
  'env',
  'venv',
]);

const BINARY_AND_ASSET_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.mov', '.avi',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar',
  '.pdf', '.exe', '.dll', '.so', '.dylib', '.bin', '.iso',
  '.sqlite', '.sqlite3', '.db',
  '.wasm', '.pyc', '.map',
]);

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
  'composer.lock',
]);

export interface GrepToolInput {
  query: string;
  path?: string;
  caseInsensitive?: boolean;
  maxResults?: number;
  pathPattern?: string;
}

/**
 * GrepTool: High-performance 3-tiered search tool
 * Tier 1: Ripgrep (if installed on host)
 * Tier 2: Git Grep (ultra-fast C native index search with .gitignore respected)
 * Tier 3: High-speed async Node engine with ignore filtering and substring pre-checks
 */
export class GrepTool extends BaseTool<GrepToolInput, string> {
  readonly name = 'grep_search';
  readonly description = 'Search for text or regex patterns across the codebase with ripgrep, git-grep, or optimized node engine.';
  readonly isReadOnly = true;

  // Cached tool availability across tool executions
  private static ripgrepAvailable: boolean | undefined = undefined;
  private static gitRootCache = new Map<string, string | null>();

  readonly inputSchema = z.object({
    query: z.string().describe('Search query or regular expression pattern'),
    path: z.string().optional().describe('Directory or file path to search within (default: current working directory)'),
    caseInsensitive: z.boolean().optional().describe('Case-insensitive search (default: false)'),
    maxResults: z.number().optional().describe('Maximum number of matching lines to return (default: 50)'),
    pathPattern: z.string().optional().describe('Optional glob pattern or file extension filter (e.g. "*.ts", "src/**")'),
  });

  async execute(args: GrepToolInput, context: ToolExecutionContext): Promise<string> {
    const searchPath = args.path
      ? path.isAbsolute(args.path)
        ? args.path
        : path.join(context.cwd, args.path)
      : context.cwd;

    const maxResults = args.maxResults || DEFAULT_MAX_RESULTS;
    const caseInsensitive = Boolean(args.caseInsensitive);

    if (!fs.existsSync(searchPath)) {
      return `Directory or file not found: "${searchPath}".`;
    }

    const stat = fs.statSync(searchPath);
    if (stat.isFile()) {
      return this.searchSingleFile(searchPath, context.cwd, args.query, caseInsensitive, maxResults);
    }

    // Tier 1: Try Ripgrep
    const rgResult = this.tryRipgrep(searchPath, args.query, caseInsensitive, maxResults, args.pathPattern);
    if (rgResult !== null) {
      return rgResult;
    }

    // Tier 2: Try Git Grep (fast C-native index search with .gitignore built-in)
    const gitGrepResult = this.tryGitGrep(searchPath, args.query, caseInsensitive, maxResults, args.pathPattern);
    if (gitGrepResult !== null) {
      return gitGrepResult;
    }

    // Tier 3: Optimized asynchronous Node engine
    return this.fastNodeSearch(searchPath, args.query, caseInsensitive, maxResults, args.pathPattern);
  }

  /**
   * Fast probe for Git root directory with in-memory caching
   */
  private getGitRoot(targetPath: string): string | null {
    const dir = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
    if (GrepTool.gitRootCache.has(dir)) {
      return GrepTool.gitRootCache.get(dir)!;
    }

    try {
      const gitRev = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (gitRev.status === 0 && gitRev.stdout) {
        const root = path.normalize(gitRev.stdout.trim());
        GrepTool.gitRootCache.set(dir, root);
        return root;
      }
    } catch {
      // Git command failed or not installed
    }

    GrepTool.gitRootCache.set(dir, null);
    return null;
  }

  /**
   * Tier 1: Ripgrep execution
   */
  private tryRipgrep(
    searchPath: string,
    query: string,
    caseInsensitive: boolean,
    maxResults: number,
    pathPattern?: string
  ): string | null {
    if (GrepTool.ripgrepAvailable === false) {
      return null;
    }

    if (GrepTool.ripgrepAvailable === undefined) {
      try {
        const check = spawnSync('rg', ['--version'], { encoding: 'utf-8', stdio: 'pipe' });
        GrepTool.ripgrepAvailable = check.status === 0;
      } catch {
        GrepTool.ripgrepAvailable = false;
      }
      if (!GrepTool.ripgrepAvailable) {
        return null;
      }
    }

    try {
      const rgArgs = ['-n', '--no-heading', '--color', 'never', '--max-count', String(maxResults)];
      if (caseInsensitive) rgArgs.push('-i');
      if (pathPattern) rgArgs.push('--glob', pathPattern);

      for (const pattern of IGNORED_DIRECTORIES) {
        rgArgs.push('--glob', `!${pattern}`);
      }

      rgArgs.push('--', query, searchPath);

      const res = spawnSync('rg', rgArgs, {
        encoding: 'utf-8',
        maxBuffer: MAX_BUFFER_SIZE,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (res.status === 0 && res.stdout) {
        const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean);
        const formatted = lines.slice(0, maxResults).map((line) => {
          const firstColon = line.indexOf(':');
          const secondColon = line.indexOf(':', firstColon + 1);
          if (firstColon === -1 || secondColon === -1) return line;

          const rawFilePath = line.substring(0, firstColon);
          const lineNum = line.substring(firstColon + 1, secondColon);
          const lineContent = line.substring(secondColon + 1);

          const absFile = path.isAbsolute(rawFilePath) ? rawFilePath : path.resolve(searchPath, rawFilePath);
          const displayPath = path.relative(searchPath, absFile).replace(/\\/g, '/') || path.basename(absFile);
          return `${displayPath}:${lineNum}:${lineContent.trim()}`;
        });
        return `Found ${lines.length} matches:\n${formatted.join('\n')}`;
      }

      if (res.status === 1) {
        return `No matches found for "${query}".`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Tier 2: Git Grep execution
   */
  private tryGitGrep(
    searchPath: string,
    query: string,
    caseInsensitive: boolean,
    maxResults: number,
    pathPattern?: string
  ): string | null {
    const gitRoot = this.getGitRoot(searchPath);
    if (!gitRoot) return null;

    try {
      // Use git grep with -I (ignore binary), -n (line number), --no-color
      const gitArgs = ['grep', '-n', '-I', '--no-color'];
      if (caseInsensitive) gitArgs.push('-i');
      gitArgs.push('-e', query);

      if (pathPattern) {
        gitArgs.push('--', pathPattern);
      } else {
        const relToRoot = path.relative(gitRoot, searchPath).replace(/\\/g, '/');
        if (relToRoot) {
          gitArgs.push('--', relToRoot);
        }
      }

      const res = spawnSync('git', gitArgs, {
        cwd: gitRoot,
        encoding: 'utf-8',
        maxBuffer: MAX_BUFFER_SIZE,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (res.status === 0 && res.stdout) {
        const rawLines = res.stdout.trim().split(/\r?\n/).filter(Boolean);
        if (rawLines.length === 0) {
          return `No matches found for "${query}".`;
        }

        const formatted = rawLines.slice(0, maxResults).map((line) => {
          const firstColon = line.indexOf(':');
          const secondColon = line.indexOf(':', firstColon + 1);
          if (firstColon === -1 || secondColon === -1) return line;

          const rawFilePath = line.substring(0, firstColon);
          const lineNum = line.substring(firstColon + 1, secondColon);
          const lineContent = line.substring(secondColon + 1);

          const absFile = path.resolve(gitRoot, rawFilePath);
          const displayPath = path.relative(searchPath, absFile).replace(/\\/g, '/') || path.basename(absFile);
          return `${displayPath}:${lineNum}:${lineContent.trim()}`;
        });

        return `Found ${rawLines.length} matches:\n${formatted.join('\n')}`;
      }

      if (res.status === 1) {
        return `No matches found for "${query}".`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Search within a single targeted file
   */
  private async searchSingleFile(
    filePath: string,
    rootPath: string,
    query: string,
    caseInsensitive: boolean,
    maxResults: number
  ): Promise<string> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        return `File "${filePath}" exceeds size limit of 2MB.`;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const isRegex = this.isRegexQuery(query);
      const lowerQuery = query.toLowerCase();

      let regex: RegExp | null = null;
      if (isRegex) {
        try {
          regex = new RegExp(query, caseInsensitive ? 'i' : '');
        } catch {
          regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'i' : '');
        }
      }

      // Fast check before splitting
      if (isRegex && regex) {
        if (!regex.test(content)) return `No matches found for "${query}".`;
      } else {
        if (caseInsensitive ? !content.toLowerCase().includes(lowerQuery) : !content.includes(query)) {
          return `No matches found for "${query}".`;
        }
      }

      const results: string[] = [];
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isMatch = isRegex && regex
          ? regex.test(line)
          : caseInsensitive
            ? line.toLowerCase().includes(lowerQuery)
            : line.includes(query);

        if (isMatch) {
          const displayPath = path.relative(rootPath, filePath).replace(/\\/g, '/') || path.basename(filePath);
          results.push(`${displayPath}:${i + 1}:${line.trim()}`);
          if (results.length >= maxResults) break;
        }
      }

      if (results.length === 0) {
        return `No matches found for "${query}".`;
      }
      return `Found ${results.length} matches:\n${results.join('\n')}`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Error searching file "${filePath}": ${msg}`;
    }
  }

  /**
   * Check if query contains regex syntax
   */
  private isRegexQuery(query: string): boolean {
    return /[.*+?^${}()|[\]\\]/.test(query);
  }

  /**
   * Tier 3: Optimized high-speed asynchronous Node search
   */
  private async fastNodeSearch(
    rootPath: string,
    query: string,
    caseInsensitive: boolean,
    maxResults: number,
    pathPattern?: string
  ): Promise<string> {
    const results: string[] = [];
    const isRegex = this.isRegexQuery(query);
    const lowerQuery = query.toLowerCase();

    let regex: RegExp | null = null;
    if (isRegex) {
      try {
        regex = new RegExp(query, caseInsensitive ? 'i' : '');
      } catch {
        regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'i' : '');
      }
    }

    // Configure ignore rules with default ignored dirs & root .gitignore
    const ig = ignore().add(IGNORED_DIRECTORIES);
    const gitignorePath = path.join(rootPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = await fs.promises.readFile(gitignorePath, 'utf-8');
        const patterns = gitignoreContent
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
        ig.add(patterns);
      } catch {
        // Ignore gitignore read errors
      }
    }

    let patternRegex: RegExp | null = null;
    if (pathPattern) {
      try {
        const escaped = pathPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*');
        patternRegex = new RegExp(escaped, 'i');
      } catch {
        patternRegex = null;
      }
    }

    // Collect candidate files with async directory queue
    const dirQueue: string[] = [rootPath];
    const candidateFiles: string[] = [];

    while (dirQueue.length > 0 && candidateFiles.length < 5000) {
      const currentDir = dirQueue.shift()!;
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
          if (ig.ignores(`${relPath}/`)) continue;
          dirQueue.push(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_AND_ASSET_EXTENSIONS.has(ext)) continue;
          if (LOCKFILE_NAMES.has(entry.name) && !lowerQuery.includes('lock')) continue;
          if (ig.ignores(relPath)) continue;
          if (patternRegex && !patternRegex.test(relPath)) continue;

          candidateFiles.push(fullPath);
        }
      }
    }

    // Scan files in batches with fast substring pre-checks
    for (let i = 0; i < candidateFiles.length; i += FILE_BATCH_SIZE) {
      if (results.length >= maxResults) break;
      const batch = candidateFiles.slice(i, i + FILE_BATCH_SIZE);

      await Promise.all(
        batch.map(async (filePath) => {
          if (results.length >= maxResults) return;
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > MAX_FILE_SIZE_BYTES) return;

            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Native V8 string check before expensive split operations
            if (isRegex && regex) {
              if (!regex.test(content)) return;
            } else {
              if (caseInsensitive ? !content.toLowerCase().includes(lowerQuery) : !content.includes(query)) {
                return;
              }
            }

            const lines = content.split(/\r?\n/);
            const relPath = path.relative(rootPath, filePath).replace(/\\/g, '/');

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              if (results.length >= maxResults) break;
              const line = lines[lineIdx];
              const isMatch = isRegex && regex
                ? regex.test(line)
                : caseInsensitive
                  ? line.toLowerCase().includes(lowerQuery)
                  : line.includes(query);

              if (isMatch) {
                results.push(`${relPath}:${lineIdx + 1}:${line.trim()}`);
              }
            }
          } catch {
            // Ignore unreadable or locked files
          }
        })
      );
    }

    if (results.length === 0) {
      return `No matches found for "${query}".`;
    }
    return `Found ${results.length} matches:\n${results.slice(0, maxResults).join('\n')}`;
  }
}
