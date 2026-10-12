import { EventEmitter } from 'events';
import type { UnifiedMessage, ToolDefinition, ToolCall } from '../types/index.js';
import type { BaseProvider } from '../providers/BaseProvider.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ModelCatalogStore } from '../providers/catalog/ModelCatalogStore.js';
import { CapabilityNegotiator } from '../providers/core/CapabilityNegotiator.js';
import { ProviderError } from '../providers/core/ProviderErrors.js';
import { MultiTierCompactor, type PostCompactReconstruction } from '../context/MultiTierCompactor.js';
import { TokenCounter } from '../context/TokenCounter.js';

export interface StateMachineConfig {
  initialProvider: string;
  initialModel: string;
  fallbackProviders?: Array<{ provider: string; model: string }>;
  maxTokens?: number;
  contextWindowBudget?: number;
}

export interface StateMachineResponse {
  text: string;
  thought?: string;
  toolCalls: ToolCall[];
  stopReason?: string;
}

export interface StateMachineStepResult {
  response: StateMachineResponse;
  activeProvider: string;
  activeModel: string;
  maxTokensAllocated: number;
  recoveryApplied?: string;
}

export class ContinuousStateMachine extends EventEmitter {
  private activeProviderName: string;
  private activeModelName: string;
  private currentProvider: BaseProvider;
  private fallbackChain: Array<{ provider: string; model: string }>;
  private currentMaxTokens: number;
  private contextWindowBudget: number;

  constructor(cfg: StateMachineConfig) {
    super();
    this.activeProviderName = cfg.initialProvider;
    this.activeModelName = cfg.initialModel;
    this.currentMaxTokens = cfg.maxTokens || 8192;
    this.contextWindowBudget = cfg.contextWindowBudget || 128000;

    const created = ProviderFactory.create(this.activeProviderName, this.activeModelName);
    this.currentProvider = created.provider;
    this.activeModelName = created.model;

    this.fallbackChain = cfg.fallbackProviders || [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'gemini', model: 'gemini-2.0-flash' },
    ];
  }

  getActiveProvider(): { provider: string; model: string; maxTokens: number } {
    return {
      provider: this.activeProviderName,
      model: this.activeModelName,
      maxTokens: this.currentMaxTokens,
    };
  }

  /**
   * Pre-API Context Preparation: evaluates token budget and applies progressive compaction
   */
  prepareContext(
    messages: UnifiedMessage[],
    reconstruction?: PostCompactReconstruction
  ): { messages: UnifiedMessage[]; compactionApplied?: string } {
    const currentTokens = TokenCounter.estimateMessagesTokens(messages);
    const thresholdTokens = Math.floor(this.contextWindowBudget * 0.8);

    // Layer 1: Micro-compact always runs to tidy verbose old outputs
    let working = MultiTierCompactor.applyMicroCompact(messages).messages;

    if (currentTokens > thresholdTokens) {
      this.emit('notice', `Token usage (${currentTokens}) exceeds 80% threshold (${thresholdTokens}). Initiating Auto-Compact...`);
      const autoRes = MultiTierCompactor.applyAutoCompact(working, reconstruction);
      return { messages: autoRes.messages, compactionApplied: autoRes.report.actionTaken };
    }

    if (currentTokens > Math.floor(this.contextWindowBudget * 0.6)) {
      const collapseRes = MultiTierCompactor.applyContextCollapse(working);
      if (collapseRes.report.tokensSaved > 0) {
        return { messages: collapseRes.messages, compactionApplied: collapseRes.report.actionTaken };
      }
    }

    return { messages: working };
  }

  /**
   * Execute model call with continuous state machine recovery:
   * - 413: triggers Layer 4 Reactive Compact and re-runs
   * - 429 / 529: activates Provider Fallback chain
   * - stop_reason = 'max_tokens': escalates output tokens
   */
  async executeStep(
    messages: UnifiedMessage[],
    tools: ToolDefinition[],
    onDelta?: (delta: string) => void,
    onThought?: (delta: string) => void,
    reconstruction?: PostCompactReconstruction
  ): Promise<StateMachineStepResult> {
    let workingMessages = [...messages];
    let recoveryApplied: string | undefined;

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        let responseText = '';
        let responseThought = '';
        const toolCalls: ToolCall[] = [];
        let stopReason = 'end_turn';

        const stream = this.currentProvider.streamChat({
          model: this.activeModelName,
          systemPrompt: '',
          messages: workingMessages,
          tools,
        });

        for await (const event of stream) {
          if (event.type === 'text_delta') {
            responseText += event.delta;
            if (onDelta) onDelta(event.delta);
          } else if (event.type === 'thought_delta') {
            responseThought += event.delta;
            if (onThought) onThought(event.delta);
          } else if (event.type === 'tool_call_done') {
            toolCalls.push(event.toolCall);
          } else if (event.type === 'finish') {
            stopReason = event.reason;
          }
        }

        // Check if output was truncated due to max_tokens -> Escalate
        if (stopReason === 'max_tokens' && this.currentMaxTokens < 64000) {
          const escalated = Math.min(64000, this.currentMaxTokens * 2);
          this.emit('notice', `Response hit max_tokens boundary (${this.currentMaxTokens}). Escalating to ${escalated} tokens...`);
          this.currentMaxTokens = escalated;
          recoveryApplied = `Escalated max_tokens to ${escalated}`;
        }

        return {
          response: {
            text: responseText,
            thought: responseThought || undefined,
            toolCalls,
            stopReason,
          },
          activeProvider: this.activeProviderName,
          activeModel: this.activeModelName,
          maxTokensAllocated: this.currentMaxTokens,
          recoveryApplied,
        };
      } catch (err: unknown) {
        const error = err as Error;
        const msg = error.message || '';

        // 1. Context Overflow (HTTP 413) -> Reactive Compact
        if (msg.includes('413') || msg.includes('prompt_too_long') || msg.includes('context_length_exceeded')) {
          this.emit('recovery', `Encountered Context Overflow error (413). Executing Reactive Compact...`);
          const reactiveRes = MultiTierCompactor.applyReactiveCompact(workingMessages, reconstruction);
          workingMessages = reactiveRes.messages;
          recoveryApplied = 'Reactive 413 Compact executed';
          continue;
        }

        // 2. Overloaded (529) or Rate Limited (429) -> Provider Fallback
        if (msg.includes('529') || msg.includes('429') || msg.includes('overloaded') || msg.includes('rate_limit')) {
          let candidateFound = false;
          while (this.fallbackChain.length > 0) {
            const nextTarget = this.fallbackChain.shift()!;

            // Invariant: If tools are active, fallback candidate MUST support tool calling
            if (tools && tools.length > 0) {
              const desc =
                ModelCatalogStore.get(nextTarget.provider, nextTarget.model) ||
                ModelCatalogStore.resolveOrCreate(nextTarget.provider, nextTarget.model);
              const evalRes = CapabilityNegotiator.evaluate(desc, { toolCalling: 'required' });
              if (!evalRes.eligible) {
                this.emit(
                  'notice',
                  `Skipping fallback candidate ${nextTarget.provider}:${nextTarget.model}: cannot satisfy required tool calling (${evalRes.rejectionReasons.join('; ')})`
                );
                continue;
              }
            }

            this.emit('recovery', `Provider ${this.activeProviderName} returned error (${msg}). Falling back to ${nextTarget.provider} (${nextTarget.model})...`);
            this.activeProviderName = nextTarget.provider;
            this.activeModelName = nextTarget.model;

            const nextCreated = ProviderFactory.create(nextTarget.provider, nextTarget.model);
            this.currentProvider = nextCreated.provider;
            recoveryApplied = `Switched provider to ${nextTarget.provider} (${nextTarget.model})`;
            candidateFound = true;
            break;
          }

          if (candidateFound) {
            continue;
          }

          if (tools && tools.length > 0) {
            throw new ProviderError({
              code: 'UNSUPPORTED_CAPABILITY',
              message: `FALLBACK_CAPABILITY_MISMATCH: All available fallback candidates fail required tool calling capability`,
              retryable: false,
            });
          }

          // No fallback candidates remain -- escalate with the actual cause
          throw new ProviderError({
            code: 'RATE_LIMITED',
            message: `All provider fallback candidates exhausted. Original error: ${msg}`,
            retryable: false,
          });
        }

        // If not recoverable or retries exhausted, throw
        throw error;
      }
    }

    throw new Error(`StateMachine failed after ${maxAttempts} recovery attempts.`);
  }
}
