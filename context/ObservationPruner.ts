import type { UnifiedMessage, ToolCall } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';
import { AstSkeletonExtractor } from './AstSkeletonExtractor.js';

/**
 * ObservationPruner manages the tool output token budget,
 * intelligently compressing older verbose tool results (via AST Skeletons for code files
 * and structured head/tail snapshots for other tools) while preserving recent context.
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

    // Build a map of toolCallId -> ToolCall arguments from assistant messages
    const toolCallMap = new Map<string, ToolCall>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.id) {
            toolCallMap.set(tc.id, tc);
          }
        }
      }
    }

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
      // Do not prune pinned messages
      if (msg.isPinned) {
        return msg;
      }

      if (msg.role === 'tool' && msg.toolResult && idx < thresholdIdx) {
        const content = msg.toolResult.content;
        const lines = content.split('\n');

        // Only prune if output is verbose (> 30 lines) and not already pruned/skeletonized
        if (lines.length > 30 && !content.startsWith('[AST Skeleton Preserved') && !content.startsWith('[Output Compacted')) {
          hasPruned = true;
          const toolCall = msg.toolCallId ? toolCallMap.get(msg.toolCallId) : undefined;
          const args = (toolCall?.arguments || {}) as Record<string, any>;
          const filePath = String(args.filePath || args.path || '');

          let summarizedContent: string;

          // 1. If it's a code file read, preserve AST skeleton (classes, functions, types, exports)
          if ((msg.toolResult.toolName === 'file_read' || filePath) && filePath.includes('.')) {
            try {
              const skeleton = AstSkeletonExtractor.extract(filePath, content);
              if (skeleton.compressionRatio > 20) {
                summarizedContent = `[AST Skeleton Preserved: ${filePath} (${skeleton.compressionRatio}% token saved - class & function signatures intact)]\n${skeleton.skeletonContent}`;
              } else {
                summarizedContent = this.formatHeadTailSnapshot(msg.toolResult.toolName, lines);
              }
            } catch {
              summarizedContent = this.formatHeadTailSnapshot(msg.toolResult.toolName, lines);
            }
          } else {
            // 2. For grep, command logs, or other tools: keep head 10 lines + tail 5 lines
            summarizedContent = this.formatHeadTailSnapshot(msg.toolResult.toolName, lines);
          }

          return {
            ...msg,
            content: summarizedContent,
            toolResult: {
              ...msg.toolResult,
              content: summarizedContent,
            },
          };
        }
      }
      return msg;
    });

    return { pruned: hasPruned, messages: prunedMessages };
  }

  private static formatHeadTailSnapshot(toolName: string, lines: string[]): string {
    const head = lines.slice(0, 10).join('\n');
    const tail = lines.slice(-5).join('\n');
    const omitted = lines.length - 15;
    return `[Output Compacted: ${toolName} (${lines.length} lines total)]\n${head}\n\n... [${omitted} intermediate output lines omitted for context reservation] ...\n\n${tail}`;
  }
}
