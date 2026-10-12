import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { CrossEncoderReranker } from '../../nn/agent/CrossEncoderReranker.js';

const semanticSearchInputSchema = z.object({
  query: z.string().describe('Natural language description or code intent to semantically search for'),
  targetDir: z.string().optional().describe('Directory to search in (defaults to workspace)'),
  topK: z.number().optional().default(5).describe('Maximum number of matches to return (default: 5)')
});

export interface SemanticSearchInput {
  query: string;
  targetDir?: string;
  topK?: number;
}

export class SemanticSearchTool extends BaseTool<SemanticSearchInput, string> {
  readonly name = 'semantic_search';
  readonly description =
    'Finds the most semantically relevant code files and functions using local neural embeddings and cross-encoder re-ranking.';
  readonly inputSchema = z.object({
    query: z.string().describe('Natural language description or code intent to semantically search for'),
    targetDir: z.string().optional().describe('Directory to search in (defaults to workspace)'),
    topK: z.number().optional().describe('Maximum number of matches to return (default: 5)')
  });
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  async execute(args: SemanticSearchInput, context: ToolExecutionContext): Promise<string> {
    const root = path.resolve(args.targetDir || context.cwd || process.cwd());

    const files = await fg(['**/*.{ts,tsx,js,jsx,py,go,rs}'], {
      cwd: root,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**'],
      onlyFiles: true
    });

    const candidates: Array<{ filePath: string; snippet: string }> = [];

    for (const relPath of files) {
      try {
        const fullPath = path.join(root, relPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        // Take head slice for file-level context
        const snippet = content.slice(0, 1500);
        candidates.push({ filePath: relPath, snippet });
      } catch {
        // Skip
      }
    }

    if (candidates.length === 0) {
      return `No matching source files found in ${root}`;
    }

    const reranked = CrossEncoderReranker.rerank(args.query, candidates, args.topK || 5);

    const lines = [
      `[Semantic Neural Search Results]`,
      `Query: "${args.query}"`,
      `Files Evaluated: ${candidates.length}`,
      ''
    ];

    for (let i = 0; i < reranked.length; i++) {
      const match = reranked[i];
      lines.push(`Match #${i + 1} (${(match.relevanceScore * 100).toFixed(1)}% relevance): ${match.filePath}`);
      const preview = match.snippet.split('\n').slice(0, 6).join('\n');
      lines.push(`\`\`\`\n${preview}\n...\n\`\`\``);
      lines.push('');
    }

    return lines.join('\n');
  }
}
