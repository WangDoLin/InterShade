export type ModelTier = 'fast_explorer' | 'deep_reasoner';

/**
 * DualLoopExecutor handles intelligent 2-tier cognitive routing.
 * Uses lightweight/fast models for search and discovery, and deep reasoning models for complex edits.
 */
export class DualLoopExecutor {
  /**
   * Determine the optimal model tier based on the current tool execution stage
   */
  static selectModelTier(isExplorationPhase: boolean, requestedModel: string): string {
    if (!isExplorationPhase) {
      return requestedModel;
    }

    // Fast Explorer mapping (lightweight, rapid reconnaissance & search)
    if (requestedModel.includes('claude-3-7') || requestedModel.includes('claude-3-5-sonnet')) {
      return 'claude-3-5-haiku-20241022';
    }
    if (requestedModel.includes('gpt-4o') || requestedModel.includes('o3-mini') || requestedModel.includes('o1')) {
      return 'gpt-4o-mini';
    }
    if (requestedModel.includes('gemini-2.5-pro') || requestedModel.includes('gemini-1.5-pro') || requestedModel.includes('gemini-2.0-pro')) {
      return 'gemini-2.5-flash';
    }
    if (requestedModel.includes('deepseek-reasoner')) {
      return 'deepseek-chat';
    }

    return requestedModel;
  }
}
