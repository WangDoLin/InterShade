import path from 'path';
import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { FtsMemoryService } from '../../services/memory/FtsMemoryService.js';

export class MemoryRecordTool extends BaseTool<
  {
    type: 'decision' | 'lesson' | 'architecture' | 'bug_pattern' | 'skill';
    title: string;
    content: string;
  },
  string
> {
  readonly name = 'memory_record';
  readonly description = 'Persist a critical architectural decision, bug pattern fix, lesson learned, or project convention into the permanent SQLite FTS5 memory store. Allows the agent and user to remember facts across long sessions.';
  readonly isReadOnly = false;
  readonly isDestructive = false;

  readonly inputSchema = z.object({
    type: z.enum(['decision', 'lesson', 'architecture', 'bug_pattern', 'skill']).describe('Category of memory to record'),
    title: z.string().describe('Short descriptive title summarizing the decision or insight'),
    content: z.string().describe('Detailed content, code invariant, rule, or explanation to remember permanently'),
  });

  async execute(
    args: {
      type: 'decision' | 'lesson' | 'architecture' | 'bug_pattern' | 'skill';
      title: string;
      content: string;
    },
    context: ToolExecutionContext
  ): Promise<string> {
    const projectId = path.basename(context.cwd) || 'default-project';

    const recorded = FtsMemoryService.recordMemory({
      projectId,
      sessionId: context.sessionId,
      type: args.type,
      title: args.title.trim(),
      content: args.content.trim(),
    });

    return [
      `[Memory Recorded Successfully]:`,
      `- ID: ${recorded.id}`,
      `- Type: [${recorded.type.toUpperCase()}]`,
      `- Title: "${recorded.title}"`,
      `- Project: ${projectId}`,
      `This memory is now permanently indexed in SQLite FTS5 BM25 and will automatically assist future prompts.`
    ].join('\n');
  }
}
