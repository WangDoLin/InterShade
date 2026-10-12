import type { ProtocolAdapter } from '../protocols/ProtocolAdapter.js';
import { OpenAIChatAdapter } from '../protocols/adapters/OpenAIChatAdapter.js';
import { OpenAIResponsesAdapter } from '../protocols/adapters/OpenAIResponsesAdapter.js';
import { AnthropicAdapter } from '../protocols/adapters/AnthropicAdapter.js';
import { GeminiAdapter } from '../protocols/adapters/GeminiAdapter.js';

export class ProviderRegistry {
  private static adapters = new Map<string, ProtocolAdapter>();

  static {
    ProviderRegistry.seedBuiltinAdapters();
  }

  static register(adapter: ProtocolAdapter): void {
    ProviderRegistry.adapters.set(adapter.protocolId.toLowerCase(), adapter);
  }

  static get(protocolId: string): ProtocolAdapter | undefined {
    return ProviderRegistry.adapters.get(protocolId.toLowerCase());
  }

  static has(protocolId: string): boolean {
    return ProviderRegistry.adapters.has(protocolId.toLowerCase());
  }

  static list(): string[] {
    return Array.from(ProviderRegistry.adapters.keys());
  }

  static clear(): void {
    ProviderRegistry.adapters.clear();
  }

  /**
   * Clear all adapters and re-register built-in adapters.
   * Use this in tests that need a clean, fully-functional registry.
   */
  static reset(): void {
    ProviderRegistry.adapters.clear();
    ProviderRegistry.seedBuiltinAdapters();
  }

  static seedBuiltinAdapters(): void {
    ProviderRegistry.register(new OpenAIChatAdapter());
    ProviderRegistry.register(new OpenAIResponsesAdapter());
    ProviderRegistry.register(new AnthropicAdapter());
    ProviderRegistry.register(new GeminiAdapter());
  }
}
