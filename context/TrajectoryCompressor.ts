import type { UnifiedMessage } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';

/**
 * Trajectory Compression Algorithm ported from Hermes Agent.
 * Protects Head (System + First goal) and Tail (last 4 turns),
 * summarizes middle turns into a factual checkpoint without filler.
 */
export class TrajectoryCompressor {
  static compressIfNeeded(
    messages: UnifiedMessage[],
    maxContextTokens: number,
    threshold = 0.75
  ): { compressed: boolean; messages: UnifiedMessage[] } {
    const currentTokens = TokenCounter.estimateMessagesTokens(messages);
    const tokenLimit = maxContextTokens * threshold;

    if (currentTokens < tokenLimit || messages.length <= 6) {
      return { compressed: false, messages };
    }

    const head = messages.slice(0, 2);
    const tail = messages.slice(-4);
    const middle = messages.slice(2, -4);

    const summaryContent = this.generateSummary(middle);

    const summaryMessage: UnifiedMessage = {
      id: `summary-${Date.now()}`,
      role: 'user',
      content: `[CONTEXT CHECKPOINT - COMPACTED HISTORY]\n${summaryContent}`,
      timestamp: Date.now(),
    };

    return {
      compressed: true,
      messages: [...head, summaryMessage, ...tail],
    };
  }

  private static generateSummary(middleMessages: UnifiedMessage[]): string {
    const executedTools: string[] = [];
    const modifiedFiles = new Set<string>();

    for (const msg of middleMessages) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          executedTools.push(tc.name);
          if (tc.name === 'file_edit' || tc.name === 'file_write') {
            const args = tc.arguments as { filePath?: string };
            if (args.filePath) modifiedFiles.add(args.filePath);
          }
        }
      }
    }

    const toolSummary = executedTools.length > 0 ? executedTools.join(' ➔ ') : 'None';
    const filesSummary = modifiedFiles.size > 0 ? Array.from(modifiedFiles).join(', ') : 'None';

    return (
      `- Executed operations: ${toolSummary}\n` +
      `- Modified/verified files: ${filesSummary}\n` +
      `- Continuing with next required steps.`
    );
  }
}
