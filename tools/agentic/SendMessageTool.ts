import { z } from 'zod';
import { BaseTool } from '../BaseTool.js';
import type { ToolExecutionContext } from '../../types/index.js';
import { MailboxQueue } from '../../services/agent/MailboxQueue.js';

export class SendMessageTool extends BaseTool<{ to: string; message: string; subject?: string }, string> {
  readonly name = 'send_agent_message';
  readonly description = 'Send an inter-agent message or broadcast to another subagent worker or the coordinator via Mailbox.';
  readonly isReadOnly = false;
  readonly isDestructive = false;
  readonly requiresPermission = false;
  readonly isDeferred = true;

  private mailbox: MailboxQueue;

  constructor(mailbox?: MailboxQueue) {
    super();
    this.mailbox = mailbox || new MailboxQueue();
  }

  readonly inputSchema = z.object({
    to: z.string().describe('Target recipient agent ID, worker name, or "*" for broadcast'),
    message: z.string().describe('Message text content to deliver'),
    subject: z.string().optional().describe('Optional message topic or subject header'),
  });

  async execute(args: { to: string; message: string; subject?: string }, _context: ToolExecutionContext): Promise<string> {
    const msg = this.mailbox.enqueue('coordinator', args.to, args.message, args.subject);
    return `Message queued in Mailbox [ID: ${msg.id}] addressed to "${args.to}".`;
  }
}
