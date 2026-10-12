import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export interface MailboxMessage {
  id: string;
  from: string;
  to: string; // Specific agentId or "*" for broadcast
  subject?: string;
  content: string;
  timestamp: number;
}

export class MailboxQueue extends EventEmitter {
  private messages: MailboxMessage[] = [];

  /**
   * Post a message to a specific recipient or broadcast "*"
   */
  enqueue(from: string, to: string, content: string, subject?: string): MailboxMessage {
    const msg: MailboxMessage = {
      id: randomUUID(),
      from,
      to,
      subject,
      content,
      timestamp: Date.now(),
    };

    this.messages.push(msg);
    this.emit('message', msg);
    this.emit(`message:${to}`, msg);

    return msg;
  }

  /**
   * Broadcast message to all active agents
   */
  broadcast(from: string, content: string, subject?: string): MailboxMessage {
    return this.enqueue(from, '*', content, subject);
  }

  /**
   * Consume and dequeue all pending messages addressed to target agent or broadcast
   */
  receive(agentId: string): MailboxMessage[] {
    const delivered: MailboxMessage[] = [];
    const remaining: MailboxMessage[] = [];

    for (const msg of this.messages) {
      if (msg.to === agentId || msg.to === '*') {
        delivered.push(msg);
      } else {
        remaining.push(msg);
      }
    }

    this.messages = remaining;
    return delivered;
  }

  /**
   * Peek at pending messages for an agent without removing them from queue
   */
  peek(agentId: string): MailboxMessage[] {
    return this.messages.filter((msg) => msg.to === agentId || msg.to === '*');
  }

  /**
   * Returns current total message count in the queue
   */
  size(): number {
    return this.messages.length;
  }

  clear(agentId?: string): void {
    if (agentId) {
      this.messages = this.messages.filter((msg) => msg.to !== agentId && msg.to !== '*');
    } else {
      this.messages = [];
    }
  }
}
