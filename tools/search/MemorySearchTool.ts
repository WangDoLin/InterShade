import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { FtsMemoryService } from '../../services/memory/FtsMemoryService.js';

export class MemorySearchTool extends BaseTool<
  { query: string; limit?: number; type?: 'decision' | 'lesson' | 'architecture' | 'bug_pattern' | 'skill' },
  string
> {
  readonly name = 'memory_search';
  readonly description = 'Search durable memories, previous bug patterns, architectural decisions, and skills using SQLite FTS5 full-text BM25 ranking.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    query: z.string().describe('Search query keywords for past memories, bug solutions, or architectural guidelines'),
    limit: z.number().optional().describe('Maximum number of memories to return (default: 5)'),
    type: z.enum(['decision', 'lesson', 'architecture', 'bug_pattern', 'skill']).optional().describe('Filter by memory type'),
  });

  async execute(
    args: { query: string; limit?: number; type?: 'decision' | 'lesson' | 'architecture' | 'bug_pattern' | 'skill' },
    _context: ToolExecutionContext
  ): Promise<string> {
    const limit = args.limit || 5;
    const results = FtsMemoryService.searchMemories(args.query, {
      limit,
      type: args.type,
    });

    if (results.length === 0) {
      return `No matching memories found for query: "${args.query}".`;
    }

    const lines: string[] = [`Found ${results.length} relevant durable memories for "${args.query}":\n`];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push(`### ${i + 1}. [${r.type.toUpperCase()}] ${r.title} (Score: ${r.rank.toFixed(2)})`);
      lines.push(`- **Snippet**: ${r.snippet}`);
      lines.push(`- **Content**: ${r.content}\n`);
    }

    return lines.join('\n');
  }
}
