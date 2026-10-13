import type { UnifiedMessage, PromptTurnEntry } from '../../types/index.js';

/**
 * Truncates prompt text cleanly for compact pill/tab display.
 * Removes line breaks and extra whitespace.
 *
 * @param text - The raw prompt text from the user.
 * @param maxLength - Maximum character length before truncation.
 * @returns Clean, truncated single-line prompt string.
 */
export function truncatePromptText(text: string, maxLength = 22): string {
  if (!text) return '';
  const singleLine = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

/**
 * Groups a sequence of unified conversation messages into discrete prompt turns.
 * Each turn begins with a user message and collects subsequent assistant and tool responses.
 *
 * @param messages - Complete array of messages from the QueryEngine.
 * @returns Array of structured PromptTurnEntry objects.
 */
export function extractPromptTurns(messages: UnifiedMessage[]): PromptTurnEntry[] {
  const turns: PromptTurnEntry[] = [];
  let currentTurn: PromptTurnEntry | null = null;

  for (const msg of messages) {
    if (msg.role === 'system') {
      continue;
    }

    if (msg.role === 'user') {
      currentTurn = {
        turnIndex: turns.length + 1,
        promptId: msg.id,
        promptText: msg.content,
        timestamp: msg.timestamp,
        messages: [msg],
      };
      turns.push(currentTurn);
    } else if (currentTurn) {
      currentTurn.messages.push(msg);
    }
  }

  return turns;
}
