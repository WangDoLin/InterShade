import type { BaseProvider } from './BaseProvider.js';
import { CompatibilityBridge } from './core/CompatibilityBridge.js';
import { config } from '../config/index.js';

export class ProviderFactory {
  static create(providerName?: string, model?: string): { provider: BaseProvider; model: string } {
    let selectedProvider = providerName || config.defaultProvider;

    // If an explicit model is passed, use it. Otherwise, if providerName is omitted or matches default, use config.defaultModel.
    // If a specific provider is requested without a model, let the connection's defaultModelId take effect.
    let selectedModel = model;
    if (!selectedModel && !providerName) {
      selectedModel = config.defaultModel;
    }

    // Normalizing legacy aliases
    const lower = selectedProvider.toLowerCase();
    if (lower === 'claude') {
      selectedProvider = 'anthropic';
    } else if (lower === 'gemini') {
      selectedProvider = 'google';
    }

    const bridged = CompatibilityBridge.create(selectedProvider, selectedModel);
    return {
      provider: bridged.provider,
      model: bridged.model,
    };
  }
}
