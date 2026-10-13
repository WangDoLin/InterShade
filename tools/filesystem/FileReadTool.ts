import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import fs from 'fs';
import path from 'path';

// Binary magic signatures from Hermes Agent
const MAGIC_SIGNATURES: Array<[Buffer, string]> = [
  [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'PNG Image'],
  [Buffer.from([0xff, 0xd8, 0xff]), 'JPEG Image'],
  [Buffer.from([0x47, 0x49, 0x46, 0x38]), 'GIF Image'],
  [Buffer.from([0x25, 0x50, 0x44, 0x46]), 'PDF Document'],
  [Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'ZIP Archive'],
  [Buffer.from([0x1f, 0x8b]), 'GZIP Compressed'],
  [Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'ELF Executable'],
  [Buffer.from([0x4d, 0x5a]), 'Windows PE Executable'],
  [Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]), 'SQLite Database'],
];

function isBinaryFile(filePath: string): { isBinary: boolean; type?: string } {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);

    const sample = buffer.subarray(0, bytesRead);

    for (const [magic, name] of MAGIC_SIGNATURES) {
      if (sample.subarray(0, magic.length).equals(magic)) {
        return { isBinary: true, type: name };
      }
    }

    // Check for NUL byte in the first 512 bytes
    for (let i = 0; i < bytesRead; i++) {
      if (sample[i] === 0) {
        return { isBinary: true, type: 'Binary Data' };
      }
    }
  } catch {
    // Ignore error and treat as non-binary
  }

  return { isBinary: false };
}

interface CachedFileContent {
  mtimeMs: number;
  size: number;
  lines: string[];
}

const MAX_CACHE_ENTRIES = 100;
const fileCache = new Map<string, CachedFileContent>();

/**
 * Clear the in-memory file read cache
 */
export function clearFileReadCache(): void {
  fileCache.clear();
}

/**
 * Return current number of cached files in memory
 */
export function getFileReadCacheSize(): number {
  return fileCache.size;
}

export class FileReadTool extends BaseTool<{ filePath: string; offset?: number; limit?: number }, string> {
  readonly name = 'file_read';
  readonly description = 'Read the contents of a file with pagination support and binary file detection.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    filePath: z.string().describe('Relative or absolute path to the file to read'),
    offset: z.number().optional().describe('Starting line number to read (1-indexed, default: 1)'),
    limit: z.number().optional().describe('Maximum number of lines to read (default: 2000)'),
  });

  async execute(args: { filePath: string; offset?: number; limit?: number }, context: ToolExecutionContext): Promise<string> {
    const resolvedPath = path.isAbsolute(args.filePath) ? args.filePath : path.join(context.cwd, args.filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`[FILE NOT FOUND]: File "${args.filePath}" does not exist at "${resolvedPath}".`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`[IS DIRECTORY]: "${args.filePath}" is a directory, not a regular file.`);
    }

    const binaryCheck = isBinaryFile(resolvedPath);
    if (binaryCheck.isBinary) {
      const sizeKb = (stat.size / 1024).toFixed(1);
      return `[BINARY FILE]: ${args.filePath} (${binaryCheck.type}, ${sizeKb} KB) cannot be displayed as text.`;
    }

    // Fast-path in-memory cached lines if mtime and size match
    let lines: string[];
    const cached = fileCache.get(resolvedPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      lines = cached.lines;
    } else {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      lines = content.split(/\r?\n/);

      if (fileCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = fileCache.keys().next().value;
        if (oldestKey) fileCache.delete(oldestKey);
      }

      fileCache.set(resolvedPath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        lines,
      });
    }

    const totalLines = lines.length;
    const offset = Math.max(1, args.offset || 1);
    const limit = Math.min(2000, args.limit || 2000);

    const startIndex = offset - 1;
    const endIndex = Math.min(totalLines, startIndex + limit);

    const slice = lines.slice(startIndex, endIndex);

    const numberedLines = slice.map((line, idx) => {
      const lineNum = (startIndex + idx + 1).toString().padStart(4, ' ');
      return `${lineNum} | ${line}`;
    });

    const header = `${args.filePath} (${offset}-${endIndex} of ${totalLines} lines)\n`;
    return header + numberedLines.join('\n');
  }
}
