import type { UnifiedMessage } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';
import { MicroCompactor } from './MicroCompactor.js';
import { randomUUID } from 'crypto';

export interface CompactionReport {
  layer: 'micro' | 'collapse' | 'auto' | 'reactive';
  originalTokens: number;
  compactedTokens: number;
  tokensSaved: number;
  actionTaken: string;
}

export interface PostCompactReconstruction {
  activeTasksSummary?: string;
  recentlyTouchedFiles?: string[];
}

export class MultiTierCompactor {
  /**
   * Layer 1: Micro-compact per-turn tool results
   */
  static applyMicroCompact(messages: UnifiedMessage[]): { messages: UnifiedMessage[]; report: CompactionReport } {
    const originalTokens = TokenCounter.estimateMessagesTokens(messages);
    const result = MicroCompactor.compact(messages, 3, 12);
    const compactedTokens = TokenCounter.estimateMessagesTokens(result.compactedMessages);

    return {
      messages: result.compactedMessages,
      report: {
        layer: 'micro',
        originalTokens,
        compactedTokens,
        tokensSaved: result.tokensSaved,
        actionTaken: `Micro-compacted ${result.compactedCount} verbose tool results.`
      }
    };
  }

  /**
   * Layer 2: Context Collapse - collapses older assistant-user banter into structured turn markers
   */
  static applyContextCollapse(messages: UnifiedMessage[]): { messages: UnifiedMessage[]; report: CompactionReport } {
    const originalTokens = TokenCounter.estimateMessagesTokens(messages);
    if (messages.length <= 8) {
      return {
        messages,
        report: { layer: 'collapse', originalTokens, compactedTokens: originalTokens, tokensSaved: 0, actionTaken: 'Skipped: insufficient turns.' }
      };
    }

    const preservedRecentCount = 4;
    const splitIndex = messages.length - preservedRecentCount;
    const oldMessages = messages.slice(0, splitIndex);
    const recentMessages = messages.slice(splitIndex);

    const collapsedOld: UnifiedMessage[] = [];
    let currentAssistantSummary: string[] = [];

    for (const msg of oldMessages) {
      if (msg.role === 'system') {
        collapsedOld.push(msg);
      } else if (msg.role === 'assistant' && msg.content) {
        currentAssistantSummary.push(msg.content.slice(0, 150));
      } else if (msg.role === 'user') {
        if (currentAssistantSummary.length > 0) {
          collapsedOld.push({
            id: randomUUID(),
            role: 'assistant',
            content: `[PRIOR TURNS SUMMARY]:\n${currentAssistantSummary.join('\n')}`,
            timestamp: Date.now()
          });
          currentAssistantSummary = [];
        }
        collapsedOld.push(msg);
      }
    }

    if (currentAssistantSummary.length > 0) {
      collapsedOld.push({
        id: randomUUID(),
        role: 'assistant',
        content: `[PRIOR TURNS SUMMARY]:\n${currentAssistantSummary.join('\n')}`,
        timestamp: Date.now()
      });
    }

    const merged = [...collapsedOld, ...recentMessages];
    const compactedTokens = TokenCounter.estimateMessagesTokens(merged);

    return {
      messages: merged,
      report: {
        layer: 'collapse',
        originalTokens,
        compactedTokens,
        tokensSaved: Math.max(0, originalTokens - compactedTokens),
        actionTaken: `Collapsed ${oldMessages.length} older messages into structured turn summaries.`
      }
    };
  }

  /**
   * Layer 3: Auto-compact - full executive compression when approaching window limits
   */
  static applyAutoCompact(
    messages: UnifiedMessage[],
    reconstruction?: PostCompactReconstruction
  ): { messages: UnifiedMessage[]; report: CompactionReport } {
    const originalTokens = TokenCounter.estimateMessagesTokens(messages);
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role === 'system');

    // Extract key historical actions
    const keyActions: string[] = [];
    for (const m of nonSystem) {
      if (m.role === 'user' && m.content) {
        keyActions.push(`User asked: "${m.content.slice(0, 100)}"`);
      } else if (m.toolResult) {
        keyActions.push(`Executed tool: ${m.toolResult.toolName} (isError: ${m.toolResult.isError})`);
      }
    }

    const summaryContent = [
      '# Conversation Compaction Boundary',
      'The prior conversation has reached the context threshold and was compacted into this summary.',
      '',
      '## Key Interaction History:',
      keyActions.slice(-15).map((a) => `- ${a}`).join('\n'),
      '',
      reconstruction?.activeTasksSummary ? `## Active Task Checklist:\n${reconstruction.activeTasksSummary}\n` : '',
      reconstruction?.recentlyTouchedFiles && reconstruction.recentlyTouchedFiles.length > 0
        ? `## Active Working Files:\n${reconstruction.recentlyTouchedFiles.map((f) => `- ${f}`).join('\n')}\n`
        : '',
      'Please proceed seamlessly with the user request.'
    ].filter(Boolean).join('\n');

    const summaryMessage: UnifiedMessage = {
      id: randomUUID(),
      role: 'user',
      content: summaryContent,
      timestamp: Date.now()
    };

    // Keep the most recent 2 turns
    const recentTurns = messages.slice(-2);
    const merged = [...systemMessages, summaryMessage, ...recentTurns];
    const compactedTokens = TokenCounter.estimateMessagesTokens(merged);

    return {
      messages: merged,
      report: {
        layer: 'auto',
        originalTokens,
        compactedTokens,
        tokensSaved: Math.max(0, originalTokens - compactedTokens),
        actionTaken: 'Executed Auto-Compact executive summary with context reconstruction.'
      }
    };
  }

  /**
   * Layer 4: Reactive Compact - emergency response for 413 HTTP errors
   */
  static applyReactiveCompact(
    messages: UnifiedMessage[],
    reconstruction?: PostCompactReconstruction
  ): { messages: UnifiedMessage[]; report: CompactionReport } {
    // Aggressive cut: Keep system prompt, inject minimal state reconstruction, keep last 1 user message
    const originalTokens = TokenCounter.estimateMessagesTokens(messages);
    const systemPrompt = messages.find((m) => m.role === 'system');
    const lastUserPrompt = [...messages].reverse().find((m) => m.role === 'user');

    const reconstructedNotice: UnifiedMessage = {
      id: randomUUID(),
      role: 'user',
      content: [
        '[REACTIVE 413 EMERGENCY COMPACTION]: Context window overflow encountered. State was hard-reset.',
        reconstruction?.activeTasksSummary ? `Active Tasks:\n${reconstruction.activeTasksSummary}` : '',
        reconstruction?.recentlyTouchedFiles ? `Files in progress:\n${reconstruction.recentlyTouchedFiles.join(', ')}` : '',
        lastUserPrompt ? `Current Pending Request: "${lastUserPrompt.content}"` : ''
      ].filter(Boolean).join('\n'),
      timestamp: Date.now()
    };

    const merged = systemPrompt ? [systemPrompt, reconstructedNotice] : [reconstructedNotice];
    const compactedTokens = TokenCounter.estimateMessagesTokens(merged);

    return {
      messages: merged,
      report: {
        layer: 'reactive',
        originalTokens,
        compactedTokens,
        tokensSaved: Math.max(0, originalTokens - compactedTokens),
        actionTaken: 'Executed Reactive Compact emergency window purge.'
      }
    };
  }
}
