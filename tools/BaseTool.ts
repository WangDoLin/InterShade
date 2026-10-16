import { z } from 'zod';
import type { ToolDefinition, ToolExecutionContext } from '../types/index.js';

/**
 * Base class for Agent tools
 */
export abstract class BaseTool<TInput = Record<string, unknown>, TOutput = unknown>
  implements ToolDefinition<TInput, TOutput> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly inputSchema: z.ZodType<TInput, any, any>;
  readonly isReadOnly: boolean = false;
  readonly isDestructive: boolean = false;
  readonly requiresPermission: boolean = false;
  readonly isDeferred: boolean = false;

  abstract execute(args: TInput, context: ToolExecutionContext): Promise<TOutput>;
}
