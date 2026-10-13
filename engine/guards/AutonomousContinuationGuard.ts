import type { UnifiedMessage } from '../../types/index.js';

export type ContinuationReason =
  | 'FORWARD_INTENT'
  | 'TRUNCATED_MAX_TOKENS'
  | 'INCOMPLETE_TOOL_ERROR_RECOVERY'
  | 'UNVERIFIED_CHANGES'
  | 'EMPTY_RESPONSE_RETRY'
  | 'UNEXECUTED_CODE_BLOCK'
  | 'INCOMPLETE_PLAN_STEPS'
  | 'NONE';

export interface ContinuationEvaluationParams {
  assistantContent: string;
  finishReason?: string;
  pendingToolCallsCount: number;
  lastToolTurnHadError: boolean;
  modifiedFilesCount: number;
  isProofModeActive: boolean;
  isPlanModeActive?: boolean;
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
  'bắt đầu|tiến hành|tiếp tục|kiểm tra|đọc|sửa|chỉnh sửa|tạo|chạy|thực hiện|xem|tìm|cập nhật|ghi|test|thử|deploy|triển khai|xóa|build|làm|xử lý|code|viết|fix|giải quyết|cấu hình|setup|khảo sát|thay đổi|áp dụng';

const ACTION_VERBS_EN =
  'inspect|read|edit|write|create|modify|run|check|test|investigate|look at|examine|update|execute|implement|verify|fix|build|continue|handle|process|proceed|do|solve|resolve|configure|setup|apply';

const INTENT_PATTERNS_VI: RegExp[] = [
  new RegExp(`(?:tôi sẽ|bây giờ tôi sẽ|tiếp theo(?:,| tôi sẽ)?|chuẩn bị|đang|sau đây tôi sẽ|dưới đây tôi sẽ)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`(?:để tôi|hãy để tôi|cần|hãy cùng|chúng ta sẽ)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`(?:bước tiếp theo|tiến hành|bắt tay vào|bắt đầu)\\s+(?:${ACTION_VERBS_VI})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`(?:kế hoạch|các bước|quy trình|giải pháp)(?:\\s+là|\\s+như sau)?:?\\s*(?:bước 1|step 1|1\\.)\\s*[^.!?\\n]{0,80}`, 'i'),
];

const INTENT_PATTERNS_EN: RegExp[] = [
  new RegExp(`\\b(?:I will|I'll|now I will|we will|next I will)\\s+(?:now\\s+)?(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:let me|allow me to|going to|about to)\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:next,?\\s+(?:I will|let's|I am going to|I'll|step is to))\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:proceeding to|I am going to|starting to|moving on to)\\s+(?:${ACTION_VERBS_EN})\\b[^.!?\\n]{0,80}`, 'i'),
  new RegExp(`\\b(?:step 1:|1\\.\\s+(?:first,?|inspect|check|read|edit|create|run|modify))\\b[^.!?\\n]{0,80}`, 'i'),
];

const COMPLETION_PATTERNS: RegExp[] = [
  /^(?:đã hoàn thành|hoàn tất|tất cả thay đổi đã xong|tất cả các bước đã hoàn tất)/i,
  /\b(?:task completed?|all changes have been made|all tests passed|everything is complete|successfully finished)\b/i,
  /\b(?:here is the explanation|hope this helps|giải thích chi tiết|kết luận:)\b/i,
];

/**
 * AutonomousContinuationGuard prevents the agent from unexpectedly halting
 * mid-task when forward action intent was declared, when code blocks were emitted without tools,
 * when multi-step plans were left unexecuted, or when output was truncated.
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

    // 1. Handle max_tokens or dangling unclosed syntax truncation
    if (params.finishReason === 'max_tokens' || this.isTextTruncated(params.assistantContent)) {
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

    // 5. Handle unexecuted code block (Assistant emitted markdown code block instead of calling tool)
    const codeFileHint = this.detectUnexecutedCodeBlock(params.assistantContent);
    if (!params.isPlanModeActive && codeFileHint) {
      return this.handleUnexecutedCodeBlock(codeFileHint);
    }

    // 6. Handle unfinished multi-step plan
    if (this.detectUnfinishedPlan(params.assistantContent, params.isPlanModeActive)) {
      return this.handleUnfinishedPlan(params.isPlanModeActive);
    }

    // 7. Handle unaddressed tool error in previous turn
    if (params.lastToolTurnHadError) {
      return this.handleToolErrorRecovery();
    }

    // 8. Handle modified files without explicit completion
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

  private handleUnexecutedCodeBlock(fileHint?: string): ContinuationDecision {
    this.consecutiveNudges++;
    const targetFileSnippet = fileHint && fileHint !== 'the target file' ? ` for ${fileHint}` : '';
    return {
      shouldContinue: true,
      reason: 'UNEXECUTED_CODE_BLOCK',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt: `[AUTONOMOUS CONTINUATION]: You provided a code implementation in markdown${targetFileSnippet}, but did not invoke any file modification tool. Do not simply print code blocks in text. Please immediately invoke file_edit or file_write to apply this code directly to the workspace.`,
    };
  }

  private handleUnfinishedPlan(isPlanMode?: boolean): ContinuationDecision {
    this.consecutiveNudges++;
    const nudgePrompt = isPlanMode
      ? '[AUTONOMOUS CONTINUATION]: You have formulated a plan. Please use the plan_mode tool (action="create" or action="update") to persist this plan into session memory and present the final plan.'
      : '[AUTONOMOUS CONTINUATION]: You formulated an implementation plan with ordered steps. Please proceed directly to execute Step 1 by invoking the required tool (such as file_read, grep_search, or file_edit). Do not halt.';

    return {
      shouldContinue: true,
      reason: 'INCOMPLETE_PLAN_STEPS',
      consecutiveNudges: this.consecutiveNudges,
      nudgePrompt,
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

  private isTextTruncated(content?: string): boolean {
    if (!content || content.length < 50) return false;
    const trimmed = content.trim();

    // Check for unclosed markdown code block (odd number of triple backticks)
    const codeBlockCount = (trimmed.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      return true;
    }

    // Check for trailing incomplete syntax or dangling connective operators at end of output
    const trailingDanglingPattern =
      /(?:=>|->|&&|\|\||[({[+=:-]|\b(?:const|let|var|function|class|import|export|return))\s*$/;
    return trailingDanglingPattern.test(trimmed);
  }

  private detectUnexecutedCodeBlock(content?: string): string | null {
    if (!content) return null;

    // Detect fenced code block with minimum content
    const codeBlockRegex = /```(?:[a-zA-Z0-9_-]*)\r?\n([\s\S]{20,}?)\r?\n```/;
    const match = content.match(codeBlockRegex);
    if (!match) return null;

    // Try to extract mentioned file path if present (e.g., "in file src/App.tsx", "file: index.ts")
    const fileHintRegex = /(?:file|trong file|tệp|đường dẫn|path)[:\s]+`?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)`?/i;
    const fileMatch = content.match(fileHintRegex);
    return fileMatch ? fileMatch[1] : 'the target file';
  }

  private detectUnfinishedPlan(content?: string, isPlanMode?: boolean): boolean {
    if (!content) return false;
    const lower = content.toLowerCase();

    const hasPlanHeader =
      lower.includes('kế hoạch') ||
      lower.includes('implementation plan') ||
      lower.includes('action plan') ||
      lower.includes('các bước thực hiện') ||
      lower.includes('steps to');

    const hasSteps =
      /(?:bước 1|step 1|1\.\s+)/i.test(content) &&
      /(?:bước 2|step 2|2\.\s+)/i.test(content);

    if (hasPlanHeader || hasSteps) {
      if (isPlanMode) {
        return !lower.includes('plan_mode') && !lower.includes('đã lưu kế hoạch');
      }
      return true;
    }

    return false;
  }

  private isExplicitlyComplete(content: string): boolean {
    const trimmed = content.trim();
    return COMPLETION_PATTERNS.some((pat) => pat.test(trimmed));
  }

  private hasPendingCodeWork(content: string): boolean {
    const lower = content.toLowerCase();
    const pendingKeywords = [
      'chưa chạy test',
      'cần kiểm tra lại',
      'need to test',
      'will test',
      'tiếp tục',
      'bước tiếp theo',
      'bước 2',
      'bước 3',
      'file tiếp theo',
      'sẽ cập nhật',
      'next step',
      'next file',
      'now modify',
      'now update',
      'proceed to',
      'remaining steps',
      'các bước còn lại',
    ];
    return pendingKeywords.some((kw) => lower.includes(kw));
  }
}

