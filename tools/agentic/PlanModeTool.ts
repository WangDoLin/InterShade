import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export class PlanModeTool extends BaseTool<{ action: 'enter' | 'exit'; planSummary?: string }, string> {
  readonly name = 'plan_mode';
  readonly description = 'Switch between Plan Mode (Read-Only architectural planning) and Normal Execution Mode.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    action: z.enum(['enter', 'exit']).describe('Enter or exit Plan Mode'),
    planSummary: z.string().optional().describe('Summary of the completed plan before requesting to exit Plan mode'),
  });

  async execute(args: { action: 'enter' | 'exit'; planSummary?: string }, context: ToolExecutionContext): Promise<string> {
    if (args.action === 'enter') {
      context.permissionMode = 'plan';
      return '[PLAN MODE ON]: Write tools and shell execution are locked to read-only. Investigate and draft implementation plan.';
    } else {
      context.permissionMode = 'default';
      return `[PLAN MODE OFF]: Execution unlocked. Plan established:\n${args.planSummary || 'Proceeding with execution.'}`;
    }
  }
}
