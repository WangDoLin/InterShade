import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type {
  UnifiedMessage,
  SessionConfig,
  SessionState,
  ToolExecutionContext,
  ToolCall,
  PermissionRequest,
  PermissionRequestDetails,
} from '../types/index.js';
import { PermissionEngine } from '../security/PermissionEngine.js';
import { SessionStore } from '../state/SessionStore.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ConnectionRegistry } from '../providers/core/ConnectionRegistry.js';
import { TrajectoryCompressor } from '../context/TrajectoryCompressor.js';
import { ObservationPruner } from '../context/ObservationPruner.js';
import { PromptCacheManager } from '../context/PromptCacheManager.js';
import { TokenCounter } from '../context/TokenCounter.js';
import { VerificationGate } from '../engine/VerificationGate.js';
import { DualLoopExecutor } from '../engine/DualLoopExecutor.js';
import { HookEngine } from '../services/hooks/HookEngine.js';
import { ParallelToolDispatcher } from '../engine/ParallelToolDispatcher.js';
import { VerificationEvidenceCollector } from '../engine/VerificationEvidenceCollector.js';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { PlanManager } from '../state/PlanManager.js';
import { config } from '../config/index.js';

function calculateModelCost(inputTokens: number, outputTokens: number, model: string): number {
  const m = model.toLowerCase();
  let inputRatePerM = 3.0;
  let outputRatePerM = 15.0;

  if (m.includes('gemini-2.5-flash') || m.includes('gemini-1.5-flash')) {
    inputRatePerM = 0.075;
    outputRatePerM = 0.30;
  } else if (m.includes('gemini-2.5-pro') || m.includes('gemini-1.5-pro')) {
    inputRatePerM = 1.25;
    outputRatePerM = 5.00;
  } else if (m.includes('claude-3-5-haiku') || m.includes('claude-3-haiku')) {
    inputRatePerM = 0.80;
    outputRatePerM = 4.00;
  } else if (m.includes('claude')) {
    inputRatePerM = 3.00;
    outputRatePerM = 15.00;
  } else if (m.includes('gpt-4o-mini')) {
    inputRatePerM = 0.15;
    outputRatePerM = 0.60;
  } else if (m.includes('gpt-4o')) {
    inputRatePerM = 2.50;
    outputRatePerM = 10.00;
  } else if (m.includes('deepseek')) {
    inputRatePerM = 0.14;
    outputRatePerM = 0.28;
  } else if (m.includes('llama') || m.includes('qwen') || m.includes('local') || m.includes('ollama')) {
    inputRatePerM = 0.00;
    outputRatePerM = 0.00;
  }

  return (inputTokens / 1_000_000) * inputRatePerM + (outputTokens / 1_000_000) * outputRatePerM;
}

export interface QueryEngineEvents {
  text: (delta: string) => void;
  thought: (delta: string) => void;
  tool_start: (name: string, id: string) => void;
  tool_progress: (progress: string) => void;
  tool_done: (name: string, id: string, result: string, isError: boolean) => void;
  permission_request: (request: PermissionRequest) => void;
  compress: () => void;
  prune: () => void;
  verification: (status: string) => void;
  usage: (input: number, output: number) => void;
  done: (finalResponse: string) => void;
  error: (err: Error) => void;
}

export class QueryEngine extends EventEmitter {
  private sessionConfig: SessionConfig;
  private sessionState: SessionState;
  private messages: UnifiedMessage[] = [];
  private toolRegistry: ToolRegistry;
  private hookEngine: HookEngine;
  private evidenceCollector: VerificationEvidenceCollector;
  private permissionEngine: PermissionEngine;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private isExplorationPhase = true;
  private currentContextTokens = 0;

  constructor(sessionConfig: SessionConfig) {
    super();
    this.sessionConfig = sessionConfig;
    this.toolRegistry = new ToolRegistry();
    this.hookEngine = new HookEngine();
    this.evidenceCollector = new VerificationEvidenceCollector();
    this.permissionEngine = new PermissionEngine(sessionConfig.permissionMode);

    // Session restoration or creation logic
    const shouldResume = sessionConfig.resumeSession !== false;
    let existingSession: SessionState | null = null;

    if (shouldResume) {
      if (sessionConfig.sessionId) {
        existingSession = SessionStore.getSession(sessionConfig.sessionId);
      } else {
        existingSession = SessionStore.findLatestSession(sessionConfig.cwd);
      }
    }

    if (existingSession) {
      this.sessionState = existingSession;
      if (sessionConfig.model && sessionConfig.model !== existingSession.model) {
        this.sessionState.model = sessionConfig.model;
      }
      if (sessionConfig.provider && sessionConfig.provider !== existingSession.provider) {
        this.sessionState.provider = sessionConfig.provider;
      }
      this.sessionState.permissionMode = sessionConfig.permissionMode;
      SessionStore.updateModel(this.sessionState.id, this.sessionState.provider, this.sessionState.model);
    } else {
      this.sessionState = SessionStore.createSession(sessionConfig);
    }

    const fullSystemContent = this.buildFullSystemContent();

    if (existingSession) {
      const savedMessages = SessionStore.getMessages(this.sessionState.id);
      if (savedMessages.length > 0) {
        this.messages = savedMessages;
        this.reconcileDanglingToolCalls();
        if (this.messages[0] && this.messages[0].role === 'system') {
          this.messages[0].content = fullSystemContent;
        } else {
          this.messages.unshift({
            id: randomUUID(),
            role: 'system',
            content: fullSystemContent,
            timestamp: Date.now(),
          });
        }
      } else {
        const systemMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'system',
          content: fullSystemContent,
          timestamp: Date.now(),
        };
        this.messages.push(systemMsg);
        SessionStore.appendMessage(this.sessionState.id, systemMsg);
      }
    } else {
      const systemMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'system',
        content: fullSystemContent,
        timestamp: Date.now(),
      };
      this.messages.push(systemMsg);
      SessionStore.appendMessage(this.sessionState.id, systemMsg);
    }

    this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
  }

  private getBasePrompt(): string {
    const languageDirective = `\n\n# Language\n- CRITICAL: Always detect and respond in the exact same language that the user uses in their message.\n- If the user communicates in Vietnamese, your entire response, explanations, thoughts, and summaries MUST be in natural Vietnamese.\n- If the user communicates in English, respond in English.\n- If the user communicates in Japanese, French, Spanish, Chinese, or any other language, mirror that language immediately.\n- Keep programming code, identifiers, and tool names in their standard technical syntax, but all explanations, advice, and conversation MUST strictly follow the user's language.\n- Never default to English when the user communicates in another language.`;

    if (this.sessionConfig.systemPrompt) {
      return `${this.sessionConfig.systemPrompt}${languageDirective}`;
    }

    return `You are InterShader, an advanced autonomous coding agent.${languageDirective}

# Grounded Action Awareness & Execution Truth
- STRICT EXECUTION TRUTH: You have NO memory or knowledge of workspace changes other than confirmed [TOOL RESULT] messages in the conversation history.
- NEVER assume or claim that a proposed tool call succeeded unless you see the explicit successful tool result in the conversation.
- If a tool call was denied, interrupted, cancelled, or returned an error, the operation DID NOT HAPPEN. You must NEVER claim that files were created, edited, deleted, or commands were executed if the tool result indicates interruption or error.
- If the user asks whether something was done, check the Action Ledger and tool results. If no successful tool result exists, state honestly that the action was not completed.
- Never state "I've created [file]" or "I've updated [file]" until after the file tool has successfully executed and returned a success confirmation.

# Output efficiency
IMPORTANT: Go straight to the point. Try the simplest approach first without going in circles. Do not overdo it. Be extra concise.

Keep your text output brief and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate what the user said - just do it. When explaining, include only what is necessary for the user to understand.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan

If you can say it in one sentence, don't use three. Prefer short, direct sentences over long explanations.

# Tone and style
- Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.
- Your responses should be short and concise.
- When referencing specific functions or pieces of code include the pattern file_path:line_number to allow the user to easily navigate to the source code location.
- When referencing GitHub issues or pull requests, use the owner/repo#123 format so they render as clickable links.
- Do not use a colon before tool calls. Your tool calls may not be shown directly in the output, so text like "Let me read the file." should end with a period, not a colon.
- When finished, summarize what was changed and what was verified. Never narrate internal pipeline processes, step numbers, or architectural modules.

# Cognitive Deliberate Reasoning Protocol
- PRE-ACTION DEEP REASONING: Before modifying files or running destructive commands, formulate a clear mental model and hypothesis. Identify the root cause, target dependencies, and potential side-effects.
- HYPOTHESIS TESTING: Verify your assumptions before modifying code. Use non-destructive inspection tools (e.g. \`serena_outline\`, \`serena_definition\`, \`grep_search\`, \`file_read\`) to confirm symbol contracts and types.
- DIAGNOSTIC COUNTER-HYPOTHESIS: When an operation fails, a tool returns an error, or a compiler/test check fails, NEVER repeat the identical failed action or guess blindly. Stop, analyze why the hypothesis failed, formulate a diagnostic counter-hypothesis, and adapt the strategy.

# Multi-Source Research & Empirical Synthesis Protocol
- WHEN TO RESEARCH: Whenever encountering unfamiliar 3rd-party libraries, framework versions, external APIs, or obscure error logs:
  1. SEARCH: Use \`reach_web_search\` to query official documentation, GitHub repositories, or community issues.
  2. READ: Use \`reach_web_read\` or \`reach_github_research\` to examine authoritative doc pages, release notes, and reference examples.
  3. SYNTHESIZE & CITE: Cross-verify documentation against the workspace. Reference URLs and issue links (e.g. owner/repo#123) in your thoughts and summaries.
  4. NEVER hallucinate API parameters or method names. When in doubt, verify against real documentation or type definitions.

# High-Assurance Professional Code Craftsmanship
- UNDERSTAND BEFORE ACTING: Read and understand existing code, imports, and architecture before writing or modifying any lines.
- NO GUESSING: Never guess requirements or code structures. If critical information is missing, ask the user immediately via \`ask_user\`.
- PREVENT NAME & ID COLLISIONS: Always inspect surrounding files and modules to verify that no variable, function, type, class, or HTML/DOM ID collides with an existing identifier.
- FUNCTION INTEGRITY & SIZING:
  - Every function must have a Single Responsibility.
  - Maximum function length is 50 lines. If a function exceeds 50 lines, decompose it into focused helper functions.
  - No magic numbers or magic strings: extract them into named constants.
- NAMING CONVENTIONS:
  - Variables and functions: camelCase (e.g., \`getUserData\`, \`isLoading\`).
  - Components and classes: PascalCase (e.g., \`UserProfile\`, \`QueryEngine\`).
  - Constants: UPPER_SNAKE_CASE (e.g., \`MAX_RETRY\`, \`API_BASE_URL\`).
  - Files: kebab-case (e.g., \`user-profile.ts\`, \`auth-service.ts\`).
  - CSS classes: kebab-case (e.g., \`.btn-primary\`, \`.card-header\`).
- MEANINGFUL ERROR HANDLING: Never use empty catch blocks or silently discard errors. Validate external inputs at system boundaries.
- PRESERVATION INVARIANT: Never delete or refactor working code unless explicitly requested. Every modification must have an explicit technical rationale.
- EMPIRICAL PROOF: "NO EVIDENCE, NO DONE." Never claim a task is complete without running verification (e.g. typecheck, automated test, or command execution) to prove correctness.

# Code Modification Rules
- In general, do not propose changes to code you haven't read. If you want to modify a file, read it first using \`file_read\`. Understand existing code before modifying.
- Use \`file_edit\` with exact matching lines and sufficient surrounding context. Never guess or hallucinate code.
- Don't add features, refactor code, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability.
- Don't add error handling or validation for scenarios that can't happen. Trust internal code and framework guarantees.
- Default to writing no comments. Only add one when the WHY is non-obvious (subtle invariants, workarounds). Don't explain WHAT well-named code does.
- Before reporting a task complete, verify it actually works: run the test, execute the command, check the output.

# Tool Usage Hierarchy
- To search the web / documentation: use \`reach_web_search\`.
- To read web documentation: use \`reach_web_read\`.
- To research GitHub repos/files: use \`reach_github_research\`.
- To inspect symbols / AST structure: use \`serena_outline\` or \`serena_definition\`.
- To read files: use \`file_read\` (never cat, head, tail in shell).
- To edit files: use \`file_edit\` (never sed, awk in shell).
- To create files: use \`file_write\`.
- To search files: use \`glob_find\` (never find, ls in shell).
- To search file contents: use \`grep_search\` (never grep, rg in shell).
- Reserve \`run_shell_command\` exclusively for commands that require true shell execution (builds, tests, package installation, git).

# Architectural Planning & Incremental Plan Merging Protocol
- When asked to plan, formulate an architectural blueprint, or operate in Plan Mode:
  - Formulate structured plans with:
    1. Clear goal title
    2. Ordered atomic implementation steps with specific target file paths
    3. Verification & acceptance criteria (tests to run, behaviors to check)
- CRITICAL - When modifying an existing plan (User asks to add features, change approach, or refine):
  - NEVER discard the previous plan or reply with an isolated disconnected snippet.
  - You MUST COMBINE AND MERGE the new requirements into the previous plan:
    - Retain all unaffected steps and mark them [UNCHANGED].
    - Mark modified steps with [UPDATED].
    - Mark newly added steps with [NEW].
  - Include a clear "Plan Changelog" summarizing what changed from the previous revision.
  - Present the full, unified updated plan so the user has a single cohesive source of truth.
  - Use the \`plan_mode\` tool with action="update" (or action="create" for initial plans) to persist the revision into session memory.`;
  }

  private getSessionModifiedFiles(): string[] {
    const fromEvidence = this.evidenceCollector.getModifiedFiles();
    const fromStore = SessionStore.getModifiedFiles(this.sessionState.id);
    const set = new Set<string>([...fromEvidence, ...fromStore]);
    return Array.from(set);
  }

  private buildFullSystemContent(): string {
    const { staticBlock, dynamicBlock } = PromptCacheManager.buildPromptCacheBlocks(
      this.getBasePrompt(),
      this.toolRegistry.getActiveTools(),
      {
        cwd: this.sessionConfig.cwd,
        model: this.sessionConfig.model,
        sessionDate: new Date().toISOString().split('T')[0],
        modifiedFiles: this.getSessionModifiedFiles(),
        activePlan: PlanManager.getActivePlan(this.sessionState.id),
      }
    );
    return `${staticBlock.text}\n${dynamicBlock.text}`;
  }

  private refreshSystemPrompt(): void {
    const fullSystemContent = this.buildFullSystemContent();
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = fullSystemContent;
    }
  }

  /**
   * Reconciles dangling tool calls in the conversation trajectory.
   * If an assistant message contains toolCalls that were never followed by
   * corresponding 'tool' messages (e.g. process termination, unhandled cancellation),
   * this inserts explicit synthetic error results marking them as [TOOL INTERRUPTED].
   * This completely prevents the model from hallucinating that unexecuted actions succeeded.
   */
  public reconcileDanglingToolCalls(): number {
    let reconciledCount = 0;
    const newMessages: UnifiedMessage[] = [];

    const fulfilledToolCallIds = new Set<string>();
    for (const msg of this.messages) {
      if (msg.role === 'tool' && msg.toolCallId) {
        fulfilledToolCallIds.add(msg.toolCallId);
      }
    }

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      newMessages.push(msg);

      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const unfulfilledCalls: ToolCall[] = [];
        for (const tc of msg.toolCalls) {
          const callId = tc.id || `call_${i}_${tc.name}`;
          if (!fulfilledToolCallIds.has(callId)) {
            unfulfilledCalls.push({ ...tc, id: callId });
          }
        }

        if (unfulfilledCalls.length > 0) {
          let nextTimestamp = msg.timestamp + 1;
          for (const tc of unfulfilledCalls) {
            const errorNotice = `[TOOL INTERRUPTED]: The tool "${tc.name}" was not executed because the session was interrupted, cancelled, or closed before completion. The operation was NOT performed.`;
            const syntheticToolMsg: UnifiedMessage = {
              id: randomUUID(),
              role: 'tool',
              content: errorNotice,
              toolCallId: tc.id,
              toolResult: {
                toolCallId: tc.id,
                toolName: tc.name,
                isError: true,
                content: errorNotice,
              },
              timestamp: nextTimestamp++,
            };

            newMessages.push(syntheticToolMsg);
            fulfilledToolCallIds.add(tc.id);
            reconciledCount++;

            SessionStore.appendMessage(this.sessionState.id, syntheticToolMsg);
          }
        }
      }
    }

    if (reconciledCount > 0) {
      this.messages = newMessages.sort((a, b) => a.timestamp - b.timestamp);
    }

    return reconciledCount;
  }

  getSessionState(): SessionState {
    return this.sessionState;
  }

  getMessages(): UnifiedMessage[] {
    return this.messages;
  }

  /**
   * Returns active context tokens currently in the conversation window.
   */
  getContextTokens(): number {
    if (this.currentContextTokens > 0) {
      return this.currentContextTokens;
    }
    return TokenCounter.estimateMessagesTokens(this.messages);
  }

  /**
   * Resets conversation history, keeping only the initial system prompt.
   */
  clearMessages(): void {
    const systemMsg = this.messages.find((m) => m.role === 'system');
    this.messages = systemMsg ? [systemMsg] : [];
    this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
  }

  /**
   * Resets the current conversation session and creates a brand new session in SessionStore.
   * If deleteCurrent is true, the old session and its history are permanently deleted from SQLite WAL.
   */
  resetSession(options?: { deleteCurrent?: boolean }): SessionState {
    const oldSessionId = this.sessionState.id;

    if (options?.deleteCurrent) {
      SessionStore.deleteSession(oldSessionId);
    }

    // Abort any in-progress requests
    this.abort();
    this.isRunning = false;
    this.isExplorationPhase = true;

    // Create a new session in SessionStore with fresh UUID
    const newSession = SessionStore.createSession({
      ...this.sessionConfig,
      sessionId: undefined,
    });

    this.sessionState = newSession;

    // Reconstruct initial system message for the new session
    const existingSystemMsg = this.messages.find((m) => m.role === 'system');
    const systemContent = existingSystemMsg
      ? existingSystemMsg.content
      : (this.sessionConfig.systemPrompt || 'You are InterShader, an advanced autonomous coding agent.');

    const freshSystemMsg: UnifiedMessage = {
      id: randomUUID(),
      role: 'system',
      content: systemContent,
      timestamp: Date.now(),
    };

    this.messages = [freshSystemMsg];
    SessionStore.appendMessage(newSession.id, freshSystemMsg);
    this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);

    this.emit('session_reset', newSession);
    return newSession;
  }

  updateSessionModel(provider: string, model: string): void {
    this.sessionConfig.provider = provider;
    this.sessionConfig.model = model;
    this.sessionState.provider = provider;
    this.sessionState.model = model;
    SessionStore.updateModel(this.sessionState.id, provider, model);
  }

  updateMaxTurns(maxTurns: number): void {
    this.sessionConfig.maxTurns = maxTurns;
  }

  getMaxTurns(): number {
    return this.sessionConfig.maxTurns !== undefined
      ? this.sessionConfig.maxTurns
      : (config.maxTurns || 100);
  }

  appendSyntheticMessage(msg: UnifiedMessage): void {
    this.messages.push(msg);
    SessionStore.appendMessage(this.sessionState.id, msg);
    this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
    this.emit('message', msg);
  }

  /**
   * Aborts the in-flight agent processing loop gracefully.
   */
  abort(): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      this.abortController.abort();
    }
  }

  /**
   * Returns whether the agent is actively executing a task.
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }


  /**
   * Sanitizes and formats raw provider errors into clear, concise, actionable messages.
   * Strips lengthy JSON error payloads, URLs, and stack traces to avoid terminal viewport overflow.
   */
  public formatProviderError(rawError: string): string {
    const errorStr = String(rawError || 'Unknown provider error');
    const lower = errorStr.toLowerCase();
    const prov = (this.sessionConfig.provider || '').toLowerCase();

    // 1. Quota / Rate limit (429) / Insufficient Quota
    if (
      errorStr.includes('429') ||
      lower.includes('quota') ||
      lower.includes('rate limit') ||
      lower.includes('resource_exhausted') ||
      lower.includes('insufficient_quota')
    ) {
      // 1a. Google Gemini Quota / Rate Limit (TPM / RPM)
      if (prov === 'google' || prov === 'gemini') {
        const retryMatch = errorStr.match(/Please retry in ([^.\n\r]+)/i) || errorStr.match(/retry in ([0-9.]+[a-zA-Z]*)/i);
        const retryInfo = retryMatch ? ` (Thoi gian cho retry: ${retryMatch[1].trim()})` : '';
        const approxK = Math.max(1, Math.round(this.sessionState.totalInputTokens / 1000));
        return [
          `[Google Gemini Rate Limit / Quota Exceeded (429)]: Model '${this.sessionConfig.model}' bi vuot nguong quota/rate limit${retryInfo}.`,
          `Nguyen nhan: Context phien hien tai (~${approxK}k tokens) da vuot gioi han Tokens Per Minute (TPM) cua Google AI Studio.`,
          'Giai phap de tiep tuc ngay:',
          '  1. Thu gon context ngay: /compact',
          '  2. Chuyen sang gateway 9Router (khong gioi han TPM): /model ag/gemini-3.8-flash-high',
          '  3. Hoac chuyen sang model khac: /model deepseek-chat hoac /model gpt-4o',
          'Kiem tra trang thai key: /key test google',
        ].join('\n');
      }

      // 1b. OpenAI Insufficient Quota ($0 Balance) or Rate Limit
      if (prov === 'openai') {
        const isProxy = (process.env.OPENAI_BASE_URL || '').includes('localhost:20128');
        if (isProxy) {
          return [
            `[9Router Gateway Error (429)]: Yeu cau qua gateway 9Router tai ${process.env.OPENAI_BASE_URL} gap loi quota hoac credentials.`,
            'Nguyen nhan: Provider tren 9Router chua duoc ket noi credentials hoac phien bi het han.',
            'Giai phap: Mo http://localhost:20128 de kiem tra Providers -> Antigravity, hoac chuyen model: /model ag/gemini-3.8-flash-high',
          ].join('\n');
        }
        return [
          `[OpenAI Quota Exceeded (429)]: Tai khoan OpenAI chua co so du (Credit Balance = $0.00).`,
          'OpenAI yeu cau nap credit toi thieu $5 tai: https://platform.openai.com/account/billing',
          'Goi y: Ban co the dung DeepSeek, Gemini, hoac gateway 9Router mien phi bang lenh: /model <ten_model>.',
          'Kiem tra trang thai key truc tiep: /key test openai',
        ].join('\n');
      }

      // 1c. DeepSeek
      if (prov === 'deepseek') {
        return `[DeepSeek Quota Exceeded (429)]: Tai khoan DeepSeek da het so du hoac bi gioi han rate limit.\nVui long kiem tra tai https://platform.deepseek.com hoac chuyen model bang /model.`;
      }

      // 1d. Anthropic
      if (prov === 'anthropic') {
        return `[Anthropic Rate Limit (429)]: Vuot qua gioi han rate limit cua Claude.\nVui long thu lai sau vai giay hoac chuyen model bang /model.`;
      }

      // 1e. Fallback
      const retryMatch = errorStr.match(/Please retry in ([^.\n\r]+)/i);
      const retryInfo = retryMatch ? ` (Thoi gian cho retry: ${retryMatch[1].trim()})` : '';
      return `[Quota Exceeded (429)]: Ban da vuot qua quota cho model '${this.sessionConfig.model}'${retryInfo}.\nGoi y: Chuyen sang model khac bang lenh /model (vi du: /model gemini-3.8-flash hoac /model deepseek-chat).`;
    }

    // 2. Model Not Found / Retired (404)
    if (errorStr.includes('404') || lower.includes('not found') || lower.includes('no longer available')) {
      return `[Model Unavailable (404)]: Model '${this.sessionConfig.model}' is unavailable or has been deprecated.\nSuggestion: Use /model to switch to a supported model (e.g. /model gemini-3.8-flash or /model gpt-4o).`;
    }


    // 3. Authentication (401 / 403)
    if (errorStr.includes('401') || errorStr.includes('403') || lower.includes('api key') || lower.includes('unauthorized')) {
      return `[Authentication Error]: API key for '${this.sessionConfig.provider}' is missing or invalid.\nSuggestion: Set your API key in .env or run /setup.`;
    }

    // 4. Network / Connection errors
    if (lower.includes('econnrefused') || lower.includes('fetch failed') || lower.includes('timeout') || lower.includes('etimedout')) {
      return `[Network Error]: Connection to '${this.sessionConfig.provider}' timed out or failed.\nSuggestion: Please check your network connection or try again.`;
    }

    // 5. Generic errors: Strip trailing raw JSON arrays/objects and lengthy URLs
    let clean = errorStr
      .replace(/\s*\[\s*\{.*$/s, '')
      .replace(/\s*\{\s*".*$/s, '')
      .replace(/https:\/\/[^\s)]+/g, (url) => url.split('?')[0])
      .trim();

    const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const compact = lines.slice(0, 3).join('\n');
    return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact;
  }

  getPermissionEngine(): PermissionEngine {
    return this.permissionEngine;
  }

  setPermissionMode(mode: SessionConfig['permissionMode']): void {
    this.sessionConfig.permissionMode = mode;
    this.sessionState.permissionMode = mode;
    this.permissionEngine.setMode(mode);
  }

  requestConfirmation(prompt: string, details?: PermissionRequestDetails): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const id = randomUUID();
      const toolName = details?.toolName || 'unknown_tool';
      const args = details?.args || {};
      const reason = details?.reason || prompt;

      const respond = (approved: boolean, remember?: boolean) => {
        if (remember && approved) {
          this.permissionEngine.addAllowRule(`${toolName}(*)`);
        }
        resolve(approved);
      };

      const req: PermissionRequest = {
        id,
        toolName,
        args,
        reason,
        respond,
      };

      this.emit('permission_request', req);
    });
  }

  /**
   * Main Agentic Conversation Loop with Observation Pruning and Verification Gating
   */
  async executeUserPrompt(userPrompt: string): Promise<string> {
    if (this.isRunning) {
      throw new Error('QueryEngine is already busy processing a request.');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      this.reconcileDanglingToolCalls();
      this.refreshSystemPrompt();

      const userMsg: UnifiedMessage = {
        id: randomUUID(),
        role: 'user',
        content: userPrompt,
        timestamp: Date.now(),
      };
      this.messages.push(userMsg);
      SessionStore.appendMessage(this.sessionState.id, userMsg);
      this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
      this.emit('user_message', userMsg);


      // 1. Pre-flight Provider Credential Check
      const activeConnection =
        ConnectionRegistry.findByProvider(this.sessionConfig.provider) ||
        ConnectionRegistry.getDefault();
      const resolvedApiKey = ConnectionRegistry.resolveApiKey(activeConnection);

      if (activeConnection.apiKeyEnv && (!resolvedApiKey || resolvedApiKey.trim().length === 0)) {
        const guidance = [
          `[Authentication Required]: No API key is configured for provider '${activeConnection.providerId}' (model: '${this.sessionConfig.model}').`,
          '',
          `To begin coding with ${activeConnection.providerId}, please configure your API key:`,
          `  1. Set ${activeConnection.apiKeyEnv}=your_api_key in your .env or shell environment.`,
          `  2. Or run the onboarding setup wizard via: /setup`,
          `  3. Or switch to a local or alternative provider: /model (e.g. ollama, deepseek, or gemini)`,
        ].join('\n');

        const noticeMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: guidance,
          timestamp: Date.now(),
        };
        this.messages.push(noticeMsg);
        SessionStore.appendMessage(this.sessionState.id, noticeMsg);
        this.emit('done', guidance);
        return guidance;
      }

      let finalAssistantResponse = '';
      let turnCount = 0;
      let completedNaturally = false;
      const maxTurns =
        this.sessionConfig.maxTurns !== undefined
          ? this.sessionConfig.maxTurns
          : (config.maxTurns || 100);

      while (maxTurns <= 0 || turnCount < maxTurns) {
        if (this.abortController?.signal.aborted) {
          finalAssistantResponse = finalAssistantResponse
            ? `${finalAssistantResponse}\n\n[Cancelled by user]`
            : '[Request cancelled by user]';
          break;
        }

        turnCount++;

        // 2. Observation Pruning: Evict old verbose tool outputs
        const pruneResult = ObservationPruner.pruneToolObservations(
          this.messages,
          config.maxContextTokens
        );
        if (pruneResult.pruned) {
          this.messages = pruneResult.messages;
          this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
          this.emit('prune');
        }

        // 3. Trajectory Compression: Summarize middle turns if token threshold is crossed
        const compressionResult = TrajectoryCompressor.compressIfNeeded(
          this.messages,
          config.maxContextTokens,
          config.autoCompactThreshold
        );
        if (compressionResult.compressed) {
          this.messages = compressionResult.messages;
          this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);
          this.emit('compress');
        }

        // 4. Dual-Loop Model Selection (Fast Explorer vs Deep Reasoner)
        const effectiveModel = this.sessionConfig.enableDualLoop
          ? DualLoopExecutor.selectModelTier(this.isExplorationPhase, this.sessionConfig.model)
          : this.sessionConfig.model;

        const { provider, model } = ProviderFactory.create(this.sessionConfig.provider, effectiveModel);

        const stream = provider.streamChat({
          model,
          systemPrompt: this.messages[0].content,
          messages: this.messages.slice(1),
          tools: this.toolRegistry.getActiveTools(),
          temperature: this.sessionConfig.temperature,
          thinkingBudget: this.sessionConfig.thinkingBudget,
          maxTokens: this.sessionConfig.maxTokens || 16384,
          signal: this.abortController.signal,
        });

        let assistantContent = '';
        let assistantThought = '';
        let streamError: string | null = null;
        const pendingToolCalls: ToolCall[] = [];
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let turnReportedUsage = false;

        for await (const event of stream) {
          if (event.type === 'text_delta') {
            assistantContent += event.delta;
            this.emit('text', event.delta);
          } else if (event.type === 'thought_delta') {
            assistantThought += event.delta;
            this.emit('thought', event.delta);
          } else if (event.type === 'tool_call_start') {
            this.emit('tool_start', event.name, event.id);
          } else if (event.type === 'tool_call_done') {
            pendingToolCalls.push(event.toolCall);
          } else if (event.type === 'usage') {
            turnReportedUsage = true;
            turnInputTokens += event.inputTokens;
            turnOutputTokens += event.outputTokens;
            this.currentContextTokens = event.inputTokens;
            this.sessionState.totalInputTokens += event.inputTokens;
            this.sessionState.totalOutputTokens += event.outputTokens;
            const costDelta = calculateModelCost(event.inputTokens, event.outputTokens, model);
            this.sessionState.totalCostUsd += costDelta;
            SessionStore.updateUsage(this.sessionState.id, event.inputTokens, event.outputTokens, costDelta);
            this.emit('usage', this.sessionState.totalInputTokens, this.sessionState.totalOutputTokens);
          } else if (event.type === 'error') {
            streamError = (event as { error?: { message?: string } }).error?.message || 'Provider request failed';
            break;
          }
        }

        if (!turnReportedUsage || (turnInputTokens === 0 && turnOutputTokens === 0)) {
          const estInput = TokenCounter.estimateMessagesTokens(this.messages);
          this.currentContextTokens = estInput;
          const estOutput =
            TokenCounter.estimateStringTokens(assistantContent) +
            TokenCounter.estimateStringTokens(assistantThought) +
            pendingToolCalls.reduce(
              (sum, tc) =>
                sum + 10 + TokenCounter.estimateStringTokens(tc.name) + TokenCounter.estimateStringTokens(JSON.stringify(tc.arguments)),
              0
            );

          if (estInput > 0 || estOutput > 0) {
            this.sessionState.totalInputTokens += estInput;
            this.sessionState.totalOutputTokens += estOutput;
            const costDelta = calculateModelCost(estInput, estOutput, model);
            this.sessionState.totalCostUsd += costDelta;
            SessionStore.updateUsage(this.sessionState.id, estInput, estOutput, costDelta);
            this.emit('usage', this.sessionState.totalInputTokens, this.sessionState.totalOutputTokens);
          }
        }

        if (streamError) {
          assistantContent = this.formatProviderError(streamError);
        } else if (!assistantContent && pendingToolCalls.length === 0) {
          assistantContent = '[Notice]: The model returned an empty response. Please verify your provider settings or prompt.';
          this.emit('text', assistantContent);
        }

        const assistantMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: assistantContent,
          toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
          thought: assistantThought || undefined,
          timestamp: Date.now(),
        };
        this.messages.push(assistantMsg);
        SessionStore.appendMessage(this.sessionState.id, assistantMsg);
        this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);

        finalAssistantResponse = assistantContent;

        if (this.abortController?.signal.aborted) {
          break;
        }

        if (streamError) {
          // If rate limit / quota exceeded and context tokens are large, auto-compact to unblock next turn
          if (this.messages.length > 3 && this.sessionState.totalInputTokens > 40000) {
            const comp = TrajectoryCompressor.compressIfNeeded(this.messages, 30000, 0.4);
            if (comp.compressed) {
              this.messages = comp.messages;
              this.emit('compress');
            }
          }
          break;
        }

        // If no tool calls -> Check verification gate & Proof Mode before declaring complete
        if (pendingToolCalls.length === 0) {
          const modifiedFiles = this.evidenceCollector.getModifiedFiles();
          const shouldVerifyTypecheck = modifiedFiles.length > 0 || this.sessionConfig.proofMode;

          if (shouldVerifyTypecheck) {
            const typecheck = VerificationGate.verifyTypeScript(this.sessionConfig.cwd);
            this.evidenceCollector.recordTypecheckResult(typecheck.passed ? 0 : 1);
            if (!typecheck.passed && typecheck.errorDetails) {
              this.emit('verification', `Verifying TypeScript build and resolving compiler diagnostics...`);
              const diagNotice = `The following TypeScript compiler errors were detected in the workspace. Please resolve them:\n${typecheck.errorDetails}`;
              const autoFeedbackMsg: UnifiedMessage = {
                id: randomUUID(),
                role: 'user',
                content: diagNotice,
                timestamp: Date.now(),
              };
              this.messages.push(autoFeedbackMsg);
              continue; // Self-healing loop
            }
          }

          if (this.sessionConfig.proofMode) {
            this.emit('verification', 'Proof Mode active: Running empirical 6-pillar verification...');
            const modifiedFiles = this.evidenceCollector.getModifiedFiles();
            const proofReport = await ProofEngine.verify(modifiedFiles, {
              cwd: this.sessionConfig.cwd,
            });

            if (!proofReport.overallPassed) {
              this.emit('verification', `Proof rejected (Score: ${proofReport.score}/100). Initiating autonomous repair loop...`);
              const failedChecks = proofReport.checks.filter((c) => !c.passed).map((c) => `- ${c.name}: ${c.message}`).join('\n');
              const repairNotice = `[PROOF MODE REPAIR REQUIRED]: Empirical verification did not pass (Score: ${proofReport.score}/100).\nFailed Checks:\n${failedChecks}\n\nPlease inspect the failures, correct the defects, and verify again.`;
              const autoRepairMsg: UnifiedMessage = {
                id: randomUUID(),
                role: 'user',
                content: repairNotice,
                timestamp: Date.now(),
              };
              this.messages.push(autoRepairMsg);
              continue; // Autonomous repair loop
            }

            this.emit('verification', `Proof verified (Score: ${proofReport.score}/100). All criteria satisfied.`);
            finalAssistantResponse = `${finalAssistantResponse}\n\n${proofReport.proofCard}`;
          }

          completedNaturally = true;
          break;
        }

        // 5. Execute Tool Calls with ParallelToolDispatcher
        const toolContext: ToolExecutionContext = {
          sessionId: this.sessionState.id,
          cwd: this.sessionConfig.cwd,
          permissionMode: this.sessionConfig.permissionMode,
          signal: this.abortController.signal,
          onProgress: (p: string) => this.emit('tool_progress', p),
          askConfirmation: (prompt: string, details?: PermissionRequestDetails) =>
            this.requestConfirmation(prompt, details),
        };

        for (const tc of pendingToolCalls) {
          if (tc.name === 'file_edit' || tc.name === 'file_write') {
            this.isExplorationPhase = false; // Transition to implementation phase
          }
        }

        const dispatchedResults = await ParallelToolDispatcher.dispatch(
          pendingToolCalls,
          this.toolRegistry,
          toolContext,
          this.hookEngine,
          (name, id, content, isError) => {
            this.emit('tool_done', name, id, content, isError);
          },
          this.permissionEngine
        );

        if (toolContext.permissionMode !== this.sessionConfig.permissionMode) {
          this.setPermissionMode(toolContext.permissionMode);
        }

        for (const dr of dispatchedResults) {
          if (!dr.isError && (dr.toolCall.name === 'file_edit' || dr.toolCall.name === 'file_write')) {
            const args = dr.toolCall.arguments as Record<string, unknown> | undefined;
            const targetPath = (args?.path || args?.filePath) as string | undefined;
            if (targetPath) {
              this.evidenceCollector.recordFileModification(targetPath);
            }
          }

          const toolMsg: UnifiedMessage = {
            id: randomUUID(),
            role: 'tool',
            content: dr.resultContent,
            toolCallId: dr.toolCall.id,
            toolResult: {
              toolCallId: dr.toolCall.id,
              toolName: dr.toolCall.name,
              isError: dr.isError,
              content: dr.resultContent,
            },
            timestamp: Date.now(),
          };
          this.messages.push(toolMsg);
          SessionStore.appendMessage(this.sessionState.id, toolMsg);
        }
        this.currentContextTokens = TokenCounter.estimateMessagesTokens(this.messages);

        // Refresh system prompt dynamic block with latest confirmed modified files
        this.refreshSystemPrompt();
      }

      // If loop exited because turn limit was reached before the task finished naturally
      if (!completedNaturally && maxTurns > 0 && turnCount >= maxTurns) {
        const limitNotice = [
          `[Turn Limit Reached]: The agent completed ${turnCount} turns (maximum allowed: ${maxTurns}).`,
          `To continue, type 'continue' or adjust the limit: /turns <number> (use /turns unlimited or /turns 0 for continuous execution).`,
        ].join('\n');
        finalAssistantResponse = finalAssistantResponse
          ? `${finalAssistantResponse}\n\n${limitNotice}`
          : limitNotice;
        const noticeMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: limitNotice,
          timestamp: Date.now(),
        };
        this.messages.push(noticeMsg);
        SessionStore.appendMessage(this.sessionState.id, noticeMsg);
      }

      // Auto-sync plan if assistant formulated or revised a plan in natural language
      if (finalAssistantResponse) {
        const extracted = PlanManager.extractPlanFromText(finalAssistantResponse);
        if (extracted && extracted.steps.length >= 2) {
          const existingPlan = PlanManager.getActivePlan(this.sessionState.id);
          if (!existingPlan) {
            PlanManager.createOrReplacePlan(this.sessionState.id, {
              title: extracted.title || 'Architectural Implementation Plan',
              overview: extracted.overview,
              steps: extracted.steps,
              acceptanceCriteria: extracted.acceptanceCriteria,
            });
          } else {
            PlanManager.mergePlan(this.sessionState.id, {
              title: extracted.title || existingPlan.title,
              overview: extracted.overview || existingPlan.overview,
              steps: extracted.steps,
              acceptanceCriteria: extracted.acceptanceCriteria,
            });
          }
        }
      }

      this.emit('done', finalAssistantResponse);
      return finalAssistantResponse;
    } catch (err: unknown) {
      this.reconcileDanglingToolCalls();
      const error = err as Error;
      if (this.abortController?.signal.aborted || error.name === 'AbortError') {
        const cancelText = '[Request cancelled by user]';
        const cancelMsg: UnifiedMessage = {
          id: randomUUID(),
          role: 'assistant',
          content: cancelText,
          timestamp: Date.now(),
        };
        this.messages.push(cancelMsg);
        SessionStore.appendMessage(this.sessionState.id, cancelMsg);
        this.emit('done', cancelText);
        return cancelText;
      }
      this.emit('error', error);
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }

  }
}
