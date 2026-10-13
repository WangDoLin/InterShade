import type { UnifiedMessage } from '../../types/index.js';

export type ContinuationReason =
  | 'FORWARD_INTENT'
  | 'TRUNCATED_MAX_TOKENS'
  | 'INCOMPLETE_TOOL_ERROR_RECOVERY'
  | 'UNVERIFIED_CHANGES'
  | 'EMPTY_RESPONSE_RETRY'
  | 'NONE';

export interface ContinuationEvaluationParams {
  assistantContent: string;
  finishReason?: string;
  pendingToolCallsCount: number;
  lastToolTurnHadError: boolean;
  modifiedFilesCount: number;
  isProofModeActive: boolean;
  recentMessages?: UnifiedMessage[];
}

export interface ContinuationDecision {
  shouldContinue: boolean;
  reason: ContinuationReason;
  intentSnippet?: string;
  nudgePrompt?: string;
  consecutiveNudges: number;
}

const ACTION_VERBS_VI =
  'bắt đầu|tiến hành|tiếp tục|kiểm tra|đọc|sửa|chỉnh sửa|tạo|chạy|thực hiện|xem|tìm|cập nhật|ghi|test|thử|deploy|triển khai|xóa|build|làm|xử lý|code|viết|fix';

const ACTION_VERBS_EN =
  'inspect|read|edit|write|create|modify|run|check|test|investigate|look at|examine|update|execute|implement|verify|fix|build|continue|handle|process|proceed|do';

const INTENT_PATTERNS_VI: RegExp[] = [
  new RegExp(`(?:tôi sẽ|bây giờ tôi sẽ|tiếp theo(?:,| tôi sẽ)?|chuẩn bị|đang)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`(?:để tôi|hãy để tôi)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`(?:bước tiếp theo|tiến hành)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
];

const INTENT_PATTERNS_EN: RegExp[] = [
  new RegExp(`\\b(?:I will|I'll|now I will)\\s+(?:now\\s+)?(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:let me|allow me to)\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:next,?\\s+(?:I will|let's|I am going to|I'll))\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:proceeding to|I am going to)\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:step 1:|1\\.\\s+(?:first,?|inspect|check|read|edit|create|run))\\b[^.!?\\n]{0,80}`, 'i'),
];

const COMPLETION_PATTERNS: RegExp[] = [
  /^(?:đã hoàn thành|hoàn tất|tất cả thay đổi đã xong|tất cả các bước đã hoàn tất)/i,
  /\b(?:task completed?|all changes have been made|all tests passed|everything is complete|successfully finished)\b/i,
  /\b(?:here is the explanation|hope this helps|giải thích chi tiết|kết luận:)\b/i,
];

/**
 * AutonomousContinuationGuard prevents the agent from unexpectedly halting
 * mid-task when forward action intent was declared or when output was truncated.
 */
export class AutonomousContinuationGuard {
  private consecutiveNudges = 0;
  private readonly maxConsecutiveNudges: number;

  constructor(maxConsecutiveNudges: number = 4) {
    this.maxConsecutiveNudges = maxConsecutiveNudges;
  }

  /**
   * Resets consecutive nudges counter when a real tool call has been executed
   */
  resetConsecutive(): void {
    this.consecutiveNudges = 0;
  }

  /**
   * Returns current consecutive nudges count
   */
  getConsecutiveCount(): number {
    return this.consecutiveNudges;
  }

  /**
   * Evaluates whether the agentic loop should continue despite 0 tool calls in current turn
   */
  evaluateTurn(params: ContinuationEvaluationParams): ContinuationDecision {
    if (params.pendingToolCallsCount > 0) {
      this.resetConsecutive();
      return { shouldContinue: false, reason: 'NONE', consecutiveNudges: 0 };
    }

    if (this.consecutiveNudges >= this.maxConsecutiveNudges) {
      return { shouldContinue: false, reason: 'NONE', consecutiveNudges: this.consecutiveNudges };
    }

    // 1. Handle max_tokens truncation
    if (params.finishReason === 'max_tokens') {
      return this.handleTruncation();
    }

    // 2. Handle empty response
    if (!params.assistantContent || params.assistantContent.trim().length === 0) {
      return this.handleEmptyResponse();
    }

    // 3. Skip continuation if assistant explicitly completed task
    if (this.isExplicitlyComplete(params.assistantContent)) {
      return { shouldContinue: false, reason: 'NONE', consecutiveNudges: this.consecutiveNudges };
    }

    // 4. Handle forward action intent without tool execution
    const intentMatch = this.detectForwardIntent(params.assistantContent);
    if (intentMatch) {
      return this.handleForwardIntent(intentMatch);
    }

    // 5. Handle unaddressed tool error in previous turn
    if (params.lastToolTurnHadError) {
      return this.handleToolErrorRecovery();
    }

    // 6. Handle modified files without explicit completion
    if (params.modifiedFilesCount > 0 && !params.isProofModeActive && this.hasPendingCodeWork(params.assistantContent)) {
      return this.handlePendingCodeWork();
    }

    return { shouldContinue: false, reason: 'NONE', consecutiveNudges: this.consecutiveNudges };
  }

  private handleTruncation(): ContinuationDecision {
    this.consecutiveNudges++;
    return {
      shouldContinue: true,
      reason: 'TRUNCATED_MAX_TOKENS',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt:
        '[AUTONOMOUS CONTINUATION]: Your previous response reached the token limit and was truncated. Please resume your work directly from where you stopped and invoke the required tool call.',
    };
  }

  private handleEmptyResponse(): ContinuationDecision {
    this.consecutiveNudges++;
    return {
      shouldContinue: true,
      reason: 'EMPTY_RESPONSE_RETRY',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt:
        '[AUTONOMOUS CONTINUATION]: The provider returned an empty response. Please proceed with your reasoning and tool execution without stopping.',
    };
  }

  private handleForwardIntent(snippet: string): ContinuationDecision {
    this.consecutiveNudges++;
    return {
      shouldContinue: true,
      reason: 'FORWARD_INTENT',
      intentSnippet: snippet,
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt: `[AUTONOMOUS CONTINUATION]: You declared intent to take action ("${snippet}"), but no tool call was executed. Do not stop or ask for confirmation; please proceed directly by invoking the appropriate tool now to continue the task.`,
    };
  }

  private handleToolErrorRecovery(): ContinuationDecision {
    this.consecutiveNudges++;
    return {
      shouldContinue: true,
      reason: 'INCOMPLETE_TOOL_ERROR_RECOVERY',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt:
        '[AUTONOMOUS CONTINUATION]: The previous tool execution encountered an error. Please inspect the diagnostic error and invoke the correcting tool call to resolve it.',
    };
  }

  private handlePendingCodeWork(): ContinuationDecision {
    this.consecutiveNudges++;
    return {
      shouldContinue: true,
      reason: 'UNVERIFIED_CHANGES',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt:
        '[AUTONOMOUS CONTINUATION]: Files have been modified in this session, but verification has not concluded. Please run the appropriate test or inspection command to ensure everything works before ending.',
    };
  }

  private detectForwardIntent(content: string): string | null {
    for (const pat of [...INTENT_PATTERNS_VI, ...INTENT_PATTERNS_EN]) {
      const match = content.match(pat);
      if (match && match[0]) {
        return match[0].trim();
      }
    }
    return null;
  }

  private isExplicitlyComplete(content: string): boolean {
    const trimmed = content.trim();
    return COMPLETION_PATTERNS.some((pat) => pat.test(trimmed));
  }

  private hasPendingCodeWork(content: string): boolean {
    const lower = content.toLowerCase();
    return (
      lower.includes('chưa chạy test') ||
      lower.includes('cần kiểm tra lại') ||
      lower.includes('need to test') ||
      lower.includes('will test')
    );
  }
}
