import type { UnifiedMessage } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';

export interface MicroCompactionResult {
  compactedMessages: UnifiedMessage[];
  compactedCount: number;
  tokensSaved: number;
}

export class MicroCompactor {
  /**
   * Compacts verbose tool outputs in older turns while preserving recent context.
   */
  static compact(
    messages: UnifiedMessage[],
    preserveRecentTurns: number = 3,
    maxToolResultLines: number = 15
  ): MicroCompactionResult {
    const initialTokens = TokenCounter.estimateMessagesTokens(messages);
    let compactedCount = 0;

    const total = messages.length;
    const boundaryIndex = Math.max(0, total - preserveRecentTurns * 2);

    const compactedMessages = messages.map((msg, index) => {
      // Only compact older tool messages
      if (index >= boundaryIndex || msg.role !== 'tool' || !msg.toolResult) {
        return msg;
      }

      const rawContent = msg.toolResult.content;
      const lines = rawContent.split('\n');

      if (lines.length <= maxToolResultLines) {
        return msg;
      }

      // Preserve first 3 lines and last 2 lines
      const head = lines.slice(0, 3).join('\n');
      const tail = lines.slice(-2).join('\n');
      const omitted = lines.length - 5;

      const summarizedContent = `${head}\n... [Micro-compacted: ${omitted} lines omitted from ${msg.toolResult.toolName} output for context efficiency] ...\n${tail}`;
      compactedCount++;

      return {
        ...msg,
        content: summarizedContent,
        toolResult: {
          ...msg.toolResult,
          content: summarizedContent
        }
      };
    });

    const finalTokens = TokenCounter.estimateMessagesTokens(compactedMessages);
    const tokensSaved = Math.max(0, initialTokens - finalTokens);

    return {
      compactedMessages,
      compactedCount,
      tokensSaved
    };
  }
}
