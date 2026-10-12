import type { UnifiedMessage } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';

/**
 * ObservationPruner manages the tool output token budget,
 * evicting old verbose tool results (read/grep outputs) to prevent context explosion.
 */
export class ObservationPruner {
  /**
   * Prunes tool outputs older than keepLastNTurns if total tokens cross threshold
   */
  static pruneToolObservations(
    messages: UnifiedMessage[],
    maxContextTokens: number,
    budgetPercent = 0.15,
    keepLastNTurns = 3
  ): { pruned: boolean; messages: UnifiedMessage[] } {
    const totalTokens = TokenCounter.estimateMessagesTokens(messages);
    const observationBudget = maxContextTokens * budgetPercent;

    // Calculate current tool observation token load
    let observationTokens = 0;
    const toolMsgIndices: number[] = [];

    messages.forEach((msg, idx) => {
      if (msg.role === 'tool' && msg.toolResult) {
        toolMsgIndices.push(idx);
        observationTokens += TokenCounter.estimateStringTokens(msg.toolResult.content);
      }
    });

    if (observationTokens < observationBudget && totalTokens < maxContextTokens * 0.6) {
      return { pruned: false, messages };
    }

    // Retain only the last N tool results in full fidelity
    const thresholdIdx =
      toolMsgIndices.length > keepLastNTurns
        ? toolMsgIndices[toolMsgIndices.length - keepLastNTurns]
        : -1;

    let hasPruned = false;

    const prunedMessages = messages.map((msg, idx) => {
      if (msg.role === 'tool' && msg.toolResult && idx < thresholdIdx) {
        const content = msg.toolResult.content;
        const lines = content.split('\n');

        // Only prune if output is verbose (> 30 lines)
        if (lines.length > 30) {
          hasPruned = true;
          const firstLine = lines[0].slice(0, 100);
          const compactNotice = `[Tool result compacted: ${msg.toolResult.toolName} output (${lines.length} lines, ${content.length} bytes) - Header: ${firstLine}]`;

          return {
            ...msg,
            content: compactNotice,
            toolResult: {
              ...msg.toolResult,
              content: compactNotice,
            },
          };
        }
      }
      return msg;
    });

    return { pruned: hasPruned, messages: prunedMessages };
  }
}
