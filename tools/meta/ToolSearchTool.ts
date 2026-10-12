import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import type { ToolRegistry } from '../ToolRegistry.js';

const ToolSearchInputSchema = z.object({
  query: z
    .string()
    .describe('Search query for deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.'),
  maxResults: z
    .number()
    .optional()
    .describe('Maximum number of results to return (default: 5)'),
});

type ToolSearchInput = z.infer<typeof ToolSearchInputSchema>;

export class ToolSearchTool extends BaseTool<ToolSearchInput, string> {
  readonly name = 'tool_search';
  readonly description =
    'Search for and activate deferred tools by keyword or direct selection (e.g. "select:pack_repository" or "select:semantic_search"). Once activated, the tool will be available for you to call directly in subsequent turns.';
  readonly inputSchema = ToolSearchInputSchema;
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;

  private registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    super();
    this.registry = registry;
  }

  async execute(args: ToolSearchInput, context: ToolExecutionContext): Promise<string> {
    const rawQuery = args.query.trim();
    const deferredTools = this.registry.getDeferredTools();

    // 1. Direct selection: "select:<tool_name>"
    if (rawQuery.toLowerCase().startsWith('select:')) {
      const targetName = rawQuery.slice('select:'.length).trim();
      const tool = this.registry.get(targetName);
      if (!tool) {
        return `[TOOL SEARCH ERROR]: Tool "${targetName}" not found in registered tools.`;
      }

      this.registry.activateDeferredTool(targetName);
      if (context.onProgress) {
        context.onProgress(`Activated deferred tool: "${targetName}"`);
      }

      return `Tool "${targetName}" has been successfully activated for this session.\nDescription: ${tool.description}\nYou can now invoke "${targetName}" directly.`;
    }

    // 2. Keyword Search
    const queryTokens = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const scoredTools: Array<{ name: string; description: string; score: number }> = [];

    for (const tool of deferredTools) {
      let score = 0;
      const lowerName = tool.name.toLowerCase();
      const lowerDesc = tool.description.toLowerCase();

      for (const token of queryTokens) {
        if (lowerName.includes(token)) score += 3;
        if (lowerDesc.includes(token)) score += 1;
      }

      if (score > 0) {
        scoredTools.push({
          name: tool.name,
          description: tool.description,
          score,
        });
      }
    }

    scoredTools.sort((a, b) => b.score - a.score);
    const max = args.maxResults || 5;
    const topMatches = scoredTools.slice(0, max);

    if (topMatches.length === 0) {
      const availableDeferred = deferredTools.map(t => t.name).join(', ');
      return `No matching deferred tools found for query "${rawQuery}".\nCurrently available deferred tools: [${availableDeferred || 'none'}]\nUse "select:<tool_name>" to activate any tool directly.`;
    }

    // Auto-activate the top match
    const top = topMatches[0];
    this.registry.activateDeferredTool(top.name);

    const resultLines: string[] = [
      `Found ${topMatches.length} matching deferred tools. (Auto-activated "${top.name}")`,
      '',
    ];

    for (const match of topMatches) {
      resultLines.push(`- **${match.name}**: ${match.description}`);
    }

    resultLines.push('');
    resultLines.push(`To activate any other tool from this list, invoke: tool_search(query: "select:<name>")`);

    return resultLines.join('\n');
  }
}
