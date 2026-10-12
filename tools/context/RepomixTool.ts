import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { SmartRepomix } from '../../context/SmartRepomix.js';

const repomixInputSchema = z.object({
  focusPaths: z
    .array(z.string())
    .optional()
    .describe('List of specific relative file or directory paths to include with full content (Tier 2 focus)'),
  maxTokens: z
    .number()
    .optional()
    .default(16000)
    .describe('Maximum total token budget for the repository snapshot (default: 16000)'),
  includeTree: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether to append the ASCII directory tree layout at the end'),
  includeAstOnly: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, only extracts AST skeletons for non-manifest files regardless of focus paths'),
  targetDir: z
    .string()
    .optional()
    .describe('Target repository directory to pack (defaults to current working directory)')
});

export interface RepomixInput {
  focusPaths?: string[];
  maxTokens?: number;
  includeTree?: boolean;
  includeAstOnly?: boolean;
  targetDir?: string;
}

export class RepomixTool extends BaseTool<RepomixInput, string> {
  readonly name = 'pack_repository';
  readonly description =
    'Packs an entire codebase or subfolder into an ultra-compact, token-optimized XML snapshot using AST Skeleton Pruning and 4-Tier Budget Allocation.';
  readonly inputSchema = z.object({
    focusPaths: z
      .array(z.string())
      .optional()
      .describe('List of specific relative file or directory paths to include with full content (Tier 2 focus)'),
    maxTokens: z
      .number()
      .optional()
      .describe('Maximum total token budget for the repository snapshot (default: 16000)'),
    includeTree: z
      .boolean()
      .optional()
      .describe('Whether to append the ASCII directory tree layout at the end'),
    includeAstOnly: z
      .boolean()
      .optional()
      .describe('When true, only extracts AST skeletons for non-manifest files regardless of focus paths'),
    targetDir: z
      .string()
      .optional()
      .describe('Target repository directory to pack (defaults to current working directory)')
  });
  readonly isReadOnly = true;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  async execute(args: RepomixInput, context: ToolExecutionContext): Promise<string> {
    const baseDir = args.targetDir || context.cwd || process.cwd();

    const result = await SmartRepomix.pack({
      baseDir,
      focusPaths: args.focusPaths,
      maxTokens: args.maxTokens || 16000,
      includeTree: args.includeTree !== false,
      includeAstOnly: args.includeAstOnly === true
    });

    const breakdownLines = result.tierBreakdown
      .map(t => `- ${t.name}: ${t.filesCount} files (~${t.tokens.toLocaleString()} tokens)`)
      .join('\n');

    return [
      `[Smart Repomix Snapshot Generated]`,
      `- Root Directory: ${result.root}`,
      `- Total Files Scanned: ${result.totalFilesFound}`,
      `- Files Packed: ${result.packedFilesCount}`,
      `- Total Snapshot Tokens: ~${result.estimatedTokens.toLocaleString()}`,
      result.truncatedDueToBudget ? `Note: Truncated early to respect maxTokens budget limit (${args.maxTokens || 16000}).` : '',
      `\nTier Breakdown:\n${breakdownLines}`,
      `\n\`\`\`xml\n${result.xml}\n\`\`\``
    ].filter(Boolean).join('\n');
  }
}
