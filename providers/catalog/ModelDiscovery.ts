import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import type { ModelDescriptor, Modality } from './ModelDescriptor.js';
import { ModelCatalogStore } from './ModelCatalogStore.js';
import { ConnectionRegistry } from '../core/ConnectionRegistry.js';
import { ProviderError } from '../core/ProviderErrors.js';
import { NetworkGuard } from '../security/NetworkGuard.js';

export interface RawDiscoveredModelItem {
  id: string;
  created?: number;
  owned_by?: string;
}

export class ModelDiscovery {
  /**
   * Query the provider's models endpoint across Anthropic, Google, and OpenAI-compatible protocols,
   * registering discovered models into ModelCatalogStore with heuristic capabilities.
   */
  static async discover(connection: ConnectionProfile, signal?: AbortSignal): Promise<ModelDescriptor[]> {
    ConnectionRegistry.validateBaseURL(connection);
    const apiKey = ConnectionRegistry.resolveApiKey(connection);
    const isAnthropic = connection.providerId === 'anthropic' || connection.protocolId === 'anthropic-messages';
    const isGoogle = connection.providerId === 'google' || connection.protocolId === 'google-genai';

    let endpoint: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...connection.headers,
    };

    if (isAnthropic) {
      const baseURL = (connection.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
      endpoint = `${baseURL}/models`;
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
    } else if (isGoogle) {
      const baseURL = (connection.baseURL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      endpoint = `${baseURL}/models`;
      if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
      }
    } else {
      const baseURL = (connection.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      endpoint = `${baseURL}/models`;
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    try {
      const response = await NetworkGuard.safeFetch(
        endpoint,
        { method: 'GET', headers, signal },
        { isLocalAllowed: connection.isLocalAllowed }
      );
      if (!response.ok) {
        throw new ProviderError({
          code: response.status === 401 ? 'AUTH_FAILED' : response.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR',
          message: `Failed to discover models from ${connection.id} (${response.status}): ${response.statusText}`,
          statusCode: response.status,
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        data?: RawDiscoveredModelItem[];
        models?: Array<{ name: string; displayName?: string }>;
      };

      let rawList: RawDiscoveredModelItem[] = [];
      if (Array.isArray(body.data)) {
        rawList = body.data;
      } else if (Array.isArray(body.models)) {
        rawList = body.models.map((m) => ({ id: m.name.replace(/^models\//, '') }));
      }

      return ModelDiscovery.parseAndRegisterModels(connection.providerId, rawList);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw ProviderError.fromUnknown(err);
    }
  }

  /**
   * Parse raw model items from /v1/models response and register into ModelCatalogStore
   */
  static parseAndRegisterModels(providerId: string, items: RawDiscoveredModelItem[]): ModelDescriptor[] {
    const discovered: ModelDescriptor[] = [];

    for (const item of items) {
      const modelId = item.id;
      const existing = ModelCatalogStore.get(providerId, modelId);

      // If already verified, keep verified catalog entry
      if (existing && existing.capabilitySource === 'verified-catalog') {
        discovered.push(existing);
        continue;
      }

      const descriptor = ModelDiscovery.heuristicDescriptor(providerId, modelId);
      ModelCatalogStore.register(descriptor);
      discovered.push(descriptor);
    }

    return discovered;
  }

  /**
   * Heuristically infer capabilities from model ID naming conventions
   */
  static heuristicDescriptor(providerId: string, modelId: string): ModelDescriptor {
    const lower = modelId.toLowerCase();

    const inputModalities: Modality[] = ['text'];
    if (lower.includes('vision') || lower.includes('-vl') || lower.includes('4o') || lower.includes('gemini')) {
      inputModalities.push('image');
    }

    const isEmbedding = lower.includes('embed') || lower.includes('embedding');
    const isReasoner = lower.includes('reasoner') || lower.includes('r1') || lower.includes('o1') || lower.includes('o3');

    let contextWindow = 128000;
    if (lower.includes('32k')) contextWindow = 32768;
    else if (lower.includes('64k')) contextWindow = 65536;
    else if (lower.includes('200k') || lower.includes('claude-3')) contextWindow = 200000;
    else if (lower.includes('1m') || lower.includes('gemini')) contextWindow = 1048576;

    return {
      providerId,
      modelId,
      inputModalities,
      outputModalities: ['text'],
      capabilities: {
        streaming: isEmbedding ? 'unsupported' : 'supported',
        toolCalling: isEmbedding || lower.includes('deepseek-reasoner') ? 'unsupported' : 'unknown',
        structuredOutput: isEmbedding ? 'unsupported' : 'unknown',
        reasoningControl: isReasoner ? 'supported' : 'unknown',
        promptCaching: lower.includes('claude') || lower.includes('deepseek') || lower.includes('gpt-4o') ? 'supported' : 'unknown',
        computerUse: lower.includes('claude-3-5-sonnet') || lower.includes('claude-3-7-sonnet') ? 'supported' : 'unsupported',
      },
      contextWindow,
      maxOutputTokens: 8192,
      lifecycle: 'stable',
      capabilitySource: 'heuristic-speculation',
    };
  }
}
