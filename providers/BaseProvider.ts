import type { UnifiedMessage, ToolDefinition, StreamEvent } from '../types/index.js';

export interface ChatStreamParams {
  model: string;
  systemPrompt: string;
  messages: UnifiedMessage[];
  tools: ToolDefinition[];
  temperature?: number;
  thinkingBudget?: number;
  signal?: AbortSignal;
}

/**
 * Abstract base class for all LLM providers
 */
export abstract class BaseProvider {
  abstract readonly name: string;

  /**
   * Primary streaming method returning an AsyncGenerator stream of events
   */
  abstract streamChat(params: ChatStreamParams): AsyncGenerator<StreamEvent, void, unknown>;
}
