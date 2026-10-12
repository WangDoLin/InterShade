import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export class AskUserTool extends BaseTool<{ question: string; options?: string[] }, string> {
  readonly name = 'ask_user';
  readonly description = 'Prompt the user with a question or choices to clarify ambiguous requirements.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    question: z.string().describe('The question or clarification request for the user'),
    options: z.array(z.string()).optional().describe('List of selectable options for the user'),
  });

  async execute(args: { question: string; options?: string[] }, context: ToolExecutionContext): Promise<string> {
    if (context.askConfirmation) {
      const optionsText = args.options ? `\nOptions:\n${args.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}` : '';
      await context.askConfirmation(`${args.question}${optionsText}`);
      return `[USER RESPONSE]: User received and answered the prompt.`;
    }
    return `[QUESTION TO USER]: ${args.question}`;
  }
}
