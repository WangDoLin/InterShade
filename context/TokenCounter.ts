import type { UnifiedMessage } from '../types/index.js';

/**
 * Token Counter and estimation heuristic for conversation context
 */
export class TokenCounter {
  static estimateStringTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  static estimateMessagesTokens(messages: UnifiedMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      total += 4;
      total += this.estimateStringTokens(msg.content);
      if (msg.thought) {
        total += this.estimateStringTokens(msg.thought);
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += 10 + this.estimateStringTokens(tc.name) + this.estimateStringTokens(JSON.stringify(tc.arguments));
        }
      }
      if (msg.toolResult) {
        total += 10 + this.estimateStringTokens(msg.toolResult.content);
      }
    }
    return total;
  }
}
