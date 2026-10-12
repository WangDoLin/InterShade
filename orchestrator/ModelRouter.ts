import { ModelRegistry, type ModelProfile } from './ModelRegistry.js';

export type TaskCategory = 'REASONING' | 'CODING' | 'REVIEW' | 'FAST';

export interface ModelRouteDecision {
  readonly category: TaskCategory;
  readonly recommendedModel: string;
  readonly recommendedProvider: 'anthropic' | 'openai' | 'gemini' | 'deepseek';
  readonly thinkingBudget?: number;
  readonly rationale: string;
  readonly fallbackChain: Array<{ model: string; provider: 'anthropic' | 'openai' | 'gemini' | 'deepseek' }>;
  readonly modelProfile?: ModelProfile;
}

export interface RouteRequest {
  prompt: string;
  fileCount?: number;
  isAudit?: boolean;
  preferredProvider?: 'anthropic' | 'openai' | 'gemini' | 'deepseek';
}

export class ModelRouter {
  private static failedProviders: Set<string> = new Set();

  /**
   * Intelligently classify task nature and select the optimal model using dynamic Model Registry
   */
  static route(request: RouteRequest): ModelRouteDecision {
    const promptLower = request.prompt.toLowerCase();
    const fileCount = request.fileCount || 1;

    // Detect available providers
    const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
    const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY);
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);

    // 1. Classification: REVIEW / SECURITY AUDIT
    if (
      request.isAudit ||
      promptLower.includes('review') ||
      promptLower.includes('audit') ||
      promptLower.includes('vulnerability') ||
      promptLower.includes('security')
    ) {
      const best = ModelRegistry.selectOptimalModel({
        primarySkill: 'review',
        requireThinking: true,
      });

      const recommendedModel = hasAnthropic ? 'claude-3-7-sonnet' : hasOpenAI ? 'gpt-4o' : hasDeepSeek ? 'deepseek-chat' : best.modelId;
      const recommendedProvider = hasAnthropic ? 'anthropic' : hasOpenAI ? 'openai' : hasDeepSeek ? 'deepseek' : 'gemini';

      return {
        category: 'REVIEW',
        recommendedModel,
        recommendedProvider,
        thinkingBudget: 4096,
        rationale: 'Review and security audit require deep static reasoning and strict boundary checks.',
        fallbackChain: [
          { model: 'gemini-3.8-flash', provider: 'gemini' },
          { model: 'gpt-4o', provider: 'openai' },
          { model: 'deepseek-chat', provider: 'deepseek' },
        ],
        modelProfile: best,
      };
    }

    // 2. Classification: HEAVY REASONING & MULTI-FILE ARCHITECTURE
    const isReasoning =
      fileCount > 5 ||
      promptLower.includes('architect') ||
      promptLower.includes('refactor') ||
      promptLower.includes('redesign') ||
      promptLower.includes('root cause') ||
      promptLower.includes('race condition') ||
      promptLower.includes('deadlock') ||
      promptLower.includes('complex bug');

    if (isReasoning) {
      const best = ModelRegistry.selectOptimalModel({
        primarySkill: 'reasoning',
        requireThinking: true,
      });

      const recommendedModel = hasAnthropic ? 'claude-3-7-sonnet' : hasOpenAI ? 'o3-mini' : hasDeepSeek ? 'deepseek-chat' : best.modelId;
      const recommendedProvider = hasAnthropic ? 'anthropic' : hasOpenAI ? 'openai' : hasDeepSeek ? 'deepseek' : 'gemini';

      return {
        category: 'REASONING',
        recommendedModel,
        recommendedProvider,
        thinkingBudget: 8192,
        rationale: 'Multi-file architecture redesign and root-cause analysis routed to high reasoning budget model.',
        fallbackChain: [
          { model: 'gemini-3.8-flash', provider: 'gemini' },
          { model: 'gpt-4o', provider: 'openai' },
          { model: 'deepseek-chat', provider: 'deepseek' },
        ],
        modelProfile: best,
      };
    }

    // 3. Classification: FAST / CHEAP (Explanations, queries, small lookups)
    const hasCodingAction =
      promptLower.includes('implement') ||
      promptLower.includes('code') ||
      promptLower.includes('write') ||
      promptLower.includes('fix') ||
      promptLower.includes('patch') ||
      promptLower.includes('edit');

    const isFast =
      !hasCodingAction &&
      (promptLower.startsWith('what is') ||
        promptLower.startsWith('explain') ||
        promptLower.startsWith('how to') ||
        promptLower.startsWith('why ') ||
        promptLower.includes('summarize') ||
        promptLower.includes('what does'));

    if (isFast) {
      const best = ModelRegistry.selectOptimalModel({
        primarySkill: 'speed',
        costPreference: 'economy',
      });

      const recommendedModel = hasGemini ? 'gemini-3.8-flash' : hasDeepSeek ? 'deepseek-chat' : best.modelId;
      const recommendedProvider = hasGemini ? 'gemini' : hasDeepSeek ? 'deepseek' : (best.provider === 'google' ? 'gemini' : best.provider);

      return {
        category: 'FAST',
        recommendedModel,
        recommendedProvider,
        rationale: 'Simple query or explanation routed to high-speed, cost-effective model (Gemini 3.8 Flash).',
        fallbackChain: [
          { model: 'gemini-3.8-flash', provider: 'gemini' },
          { model: 'deepseek-chat', provider: 'deepseek' },
          { model: 'gpt-4o', provider: 'openai' },
        ],
        modelProfile: best,
      };
    }

    // 4. Default: CODING (Standard patch implementation & tool execution)
    const bestCoding = ModelRegistry.selectOptimalModel({
      primarySkill: 'coding',
    });

    const codingModel = hasAnthropic ? 'claude-3-7-sonnet' : hasOpenAI ? 'gpt-4o' : hasDeepSeek ? 'deepseek-chat' : bestCoding.modelId;
    const codingProvider = hasAnthropic ? 'anthropic' : hasOpenAI ? 'openai' : hasDeepSeek ? 'deepseek' : 'gemini';

    return {
      category: 'CODING',
      recommendedModel: codingModel,
      recommendedProvider: codingProvider,
      thinkingBudget: 2048,
      rationale: 'Standard surgical coding and tool execution loop.',
      fallbackChain: [
        { model: 'gemini-3.8-flash', provider: 'gemini' },
        { model: 'gpt-4o', provider: 'openai' },
        { model: 'deepseek-chat', provider: 'deepseek' },
      ],
      modelProfile: bestCoding,
    };
  }

  /**
   * Record provider failure (e.g. rate limit 429 / 529) to dynamically bypass in fallback chain
   */
  static markProviderFailure(provider: string): void {
    this.failedProviders.add(provider);
  }

  /**
   * Reset provider health states
   */
  static resetProviderFailures(): void {
    this.failedProviders.clear();
  }

  /**
   * Retrieve next available fallback provider not currently marked as failed
   */
  static getActiveFallback(
    currentProvider: string,
    fallbackChain: Array<{ model: string; provider: 'anthropic' | 'openai' | 'gemini' | 'deepseek' }>
  ): { model: string; provider: 'anthropic' | 'openai' | 'gemini' | 'deepseek' } | null {
    for (const fb of fallbackChain) {
      if (fb.provider !== currentProvider && !this.failedProviders.has(fb.provider)) {
        return fb;
      }
    }
    return fallbackChain[0] || null;
  }
}
