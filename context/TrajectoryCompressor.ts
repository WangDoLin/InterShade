import type { UnifiedMessage } from '../types/index.js';
import { TokenCounter } from './TokenCounter.js';

/**
 * Semantic Trajectory Distiller (Ported & Enhanced from Hermes Agent).
 * Protects Head (System + First goal), Pinned Anchors, and Tail (last 4 turns),
 * distilling middle turns into a high-fidelity structured semantic checkpoint
 * that preserves user directives, technical root causes, and architectural decisions.
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

    // Extract any pinned messages in the middle to permanently preserve them
    const pinnedInMiddle = middle.filter((m) => m.isPinned);
    const unpinnedMiddle = middle.filter((m) => !m.isPinned);

    if (unpinnedMiddle.length === 0) {
      return { compressed: false, messages };
    }

    const summaryContent = this.generateSemanticDistillation(unpinnedMiddle);

    const summaryMessage: UnifiedMessage = {
      id: `summary-${Date.now()}`,
      role: 'user',
      content: `[CONTEXT CHECKPOINT - SEMANTIC DISTILLATION]\n${summaryContent}`,
      timestamp: Date.now(),
    };

    return {
      compressed: true,
      messages: [...head, ...pinnedInMiddle, summaryMessage, ...tail],
    };
  }

  private static generateSemanticDistillation(middleMessages: UnifiedMessage[]): string {
    const userDirectives: string[] = [];
    const keyFindings: string[] = [];
    const modifiedFiles = new Set<string>();
    const executedTools: string[] = [];

    for (const msg of middleMessages) {
      // 1. Capture User Requests & Directives
      if (msg.role === 'user' && msg.content) {
        const trimmed = msg.content.trim();
        // Skip purely ephemeral confirmations
        if (trimmed.length > 5 && !['ok', 'yes', 'y', 'tiep tuc', 'continue'].includes(trimmed.toLowerCase())) {
          userDirectives.push(`- "${trimmed.slice(0, 250)}"`);
        }
      }

      // 2. Capture Tool Invocations & File Modifications
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          executedTools.push(tc.name);
          if (tc.name === 'file_edit' || tc.name === 'file_write') {
            const args = tc.arguments as { filePath?: string; path?: string };
            const file = args.filePath || args.path;
            if (file) modifiedFiles.add(file);
          }
        }
      }

      // 3. Capture Important Tool Outcomes (Errors or Root Causes)
      if (msg.role === 'tool' && msg.toolResult) {
        if (msg.toolResult.isError) {
          keyFindings.push(`- Issue encountered in ${msg.toolResult.toolName}: ${msg.toolResult.content.slice(0, 150)}`);
        }
      }

      // 4. Capture Assistant Technical Conclusions
      if (msg.role === 'assistant' && msg.content) {
        const lines = msg.content.split('\n');
        for (const line of lines) {
          const l = line.trim();
          if (
            l.startsWith('#') ||
            l.toLowerCase().includes('nguyen nhan') ||
            l.toLowerCase().includes('root cause') ||
            l.toLowerCase().includes('quyet dinh') ||
            l.toLowerCase().includes('decision')
          ) {
            keyFindings.push(`- Insight: ${l.slice(0, 180)}`);
            break;
          }
        }
      }
    }

    const sections: string[] = [
      '### User Directives & Constraints Covered in Prior Turns:',
      userDirectives.length > 0 ? userDirectives.slice(-8).join('\n') : '- (Initial session instructions)',
      '',
      '### Key Technical Discoveries & Resolutions:',
      keyFindings.length > 0 ? keyFindings.slice(-8).join('\n') : '- Routine file inspections and code navigation executed cleanly.',
      '',
      '### Modified Working Files Ledger:',
      modifiedFiles.size > 0 ? Array.from(modifiedFiles).map((f) => `- ${f}`).join('\n') : '- None modified in middle turns.',
      '',
      '### Operation Flow Summary:',
      executedTools.length > 0 ? executedTools.slice(-15).join(' ➔ ') : 'None',
      '',
      '### Directive for Model:',
      'Please proceed seamlessly with the recent conversation flow without losing previous architectural context.'
    ];

    return sections.join('\n');
  }
}
