import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';

export interface AskUserInput {
  question: string;
  options?: string[];
  allowCustomInput?: boolean;
}

export class AskUserTool extends BaseTool<AskUserInput, string> {
  readonly name = 'ask_user';
  readonly description =
    'Prompt the user with an interactive question or multiple-choice options to clarify requirements, solicit preferences, or pick solutions. Modeled after Claude Code AskUserQuestion.';
  readonly isReadOnly = true;

  readonly inputSchema = z.object({
    question: z.string().describe('The question or clarification request for the user'),
    options: z.array(z.string()).optional().describe('List of selectable options for the user'),
    allowCustomInput: z
      .boolean()
      .optional()
      .describe('Whether the user can provide a custom write-in text response (default: true)'),
  });

  async execute(args: AskUserInput, context: ToolExecutionContext): Promise<string> {
    if (context.askQuestion) {
      const answer = await context.askQuestion(
        args.question,
        args.options,
        args.allowCustomInput !== false
      );
      return `[USER ANSWER]: ${answer.trim() || '(No answer provided)'}`;
    }

    if (context.askConfirmation) {
      const optionsText = args.options
        ? `\nOptions:\n${args.options.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
        : '';
      const confirmed = await context.askConfirmation(`${args.question}${optionsText}`);
      return confirmed
        ? `[USER CONFIRMED]: User acknowledged the prompt: "${args.question}"`
        : `[USER DECLINED]: User declined the prompt: "${args.question}"`;
    }

    return `[QUESTION TO USER]: ${args.question}`;
  }
}
