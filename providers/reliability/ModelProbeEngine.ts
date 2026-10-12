import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import { ConnectionRegistry } from '../core/ConnectionRegistry.js';
import { ModelCatalogStore } from '../catalog/ModelCatalogStore.js';
import { ModelDiscovery } from '../catalog/ModelDiscovery.js';
import { NetworkGuard } from '../security/NetworkGuard.js';
import { SecretSanitizer } from '../security/SecretSanitizer.js';

export type ModelProbeStatus =
  | 'USABLE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'UNREACHABLE';

export interface ModelProbeResult {
  providerId: string;
  modelId: string;
  connectionId: string;
  status: ModelProbeStatus;
  httpStatus?: number;
  latencyMs?: number;
  toolCallingSupport: 'supported' | 'unsupported' | 'unknown';
  message: string;
  testedAt: number;
}

export class ModelProbeEngine {
  /**
   * Execute an ultra-lightweight probe request (max_tokens: 1) to test live provider accessibility for a model
   */
  static async probeModel(
    connection: ConnectionProfile,
    modelId: string,
    timeoutMs = 6000
  ): Promise<ModelProbeResult> {
    ConnectionRegistry.validateBaseURL(connection);
    const apiKey = ConnectionRegistry.resolveApiKey(connection);
    const isLocal = Boolean(connection.isLocalAllowed);

    const desc = ModelCatalogStore.get(connection.providerId, modelId) ||
                 ModelCatalogStore.resolveOrCreate(connection.providerId, modelId);
    const toolCallingSupport = desc.capabilities.toolCalling;

    if (connection.apiKeyEnv && !apiKey && !isLocal) {
      return {
        providerId: connection.providerId,
        modelId,
        connectionId: connection.id,
        status: 'AUTH_FAILED',
        toolCallingSupport,
        message: `API key environment variable '${connection.apiKeyEnv}' is not set`,
        testedAt: Date.now(),
      };
    }

    const isAnthropic = connection.providerId === 'anthropic' || connection.protocolId === 'anthropic-messages';
    const isGoogle = connection.providerId === 'google' || connection.protocolId === 'google-genai';

    let endpoint: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...connection.headers,
    };
    let body: string;

    if (isAnthropic) {
      const baseURL = (connection.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
      endpoint = `${baseURL}/messages`;
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
      body = JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    } else if (isGoogle) {
      const baseURL = (connection.baseURL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      endpoint = `${baseURL}/models/${modelId}:generateContent`;
      if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
      }
      body = JSON.stringify({
        contents: [{ parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 1 },
      });
    } else {
      const baseURL = (connection.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      endpoint = `${baseURL}/chat/completions`;
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      body = JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      const res = await NetworkGuard.safeFetch(
        endpoint,
        {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        },
        { isLocalAllowed: connection.isLocalAllowed }
      );

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      const httpStatus = res.status;

      let status: ModelProbeStatus;
      let message: string;

      if (res.ok) {
        status = 'USABLE';
        message = 'Model is online, accessible, and responsive';
      } else if (httpStatus === 401) {
        status = 'AUTH_FAILED';
        message = 'Authentication failed (invalid, expired, or missing credentials)';
      } else if (httpStatus === 403) {
        status = 'FORBIDDEN';
        message = 'Access forbidden (API key lacks tier or permission for this specific model)';
      } else if (httpStatus === 404) {
        status = 'NOT_FOUND';
        message = 'Model ID not found or deprecated by provider';
      } else if (httpStatus === 429) {
        status = 'RATE_LIMITED';
        message = 'Rate limit reached or provider quota exhausted';
      } else if (httpStatus >= 500) {
        status = 'SERVER_ERROR';
        message = `Provider returned server error (HTTP ${httpStatus})`;
      } else {
        // Read response body snippet for error explanation
        let errSnippet = res.statusText;
        try {
          const errJson = await res.json() as { error?: { message?: string } };
          if (errJson.error?.message) {
            errSnippet = errJson.error.message;
          }
        } catch {
          // ignore parse errors
        }
        status = 'FORBIDDEN';
        message = SecretSanitizer.sanitize(`Request rejected (HTTP ${httpStatus}): ${errSnippet}`);
      }

      return {
        providerId: connection.providerId,
        modelId,
        connectionId: connection.id,
        status,
        httpStatus,
        latencyMs,
        toolCallingSupport,
        message: SecretSanitizer.sanitize(message),
        testedAt: Date.now(),
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;

      if (controller.signal.aborted) {
        return {
          providerId: connection.providerId,
          modelId,
          connectionId: connection.id,
          status: 'TIMEOUT',
          latencyMs,
          toolCallingSupport,
          message: `Probe request timed out after ${timeoutMs}ms`,
          testedAt: Date.now(),
        };
      }

      const rawMsg = err instanceof Error ? err.message : String(err);
      return {
        providerId: connection.providerId,
        modelId,
        connectionId: connection.id,
        status: 'UNREACHABLE',
        latencyMs,
        toolCallingSupport,
        message: SecretSanitizer.sanitize(`Network or connection error: ${rawMsg}`),
        testedAt: Date.now(),
      };
    }
  }

  /**
   * Probe multiple models with bounded concurrency
   */
  static async probeAll(options: {
    providerId?: string;
    modelIds?: string[];
    timeoutMs?: number;
    concurrency?: number;
  } = {}): Promise<ModelProbeResult[]> {
    const concurrency = options.concurrency ?? 5;
    const timeoutMs = options.timeoutMs ?? 6000;

    let targets: Array<{ connection: ConnectionProfile; modelId: string }> = [];

    if (options.modelIds && options.modelIds.length > 0) {
      const provider = options.providerId || 'anthropic';
      const conn = ConnectionRegistry.findByProvider(provider) || ConnectionRegistry.getDefault();
      targets = options.modelIds.map((m) => ({ connection: conn, modelId: m }));
    } else if (options.providerId) {
      const conn = ConnectionRegistry.findByProvider(options.providerId);
      if (conn) {
        let models = ModelCatalogStore.list(options.providerId);
        if (models.length === 0) {
          try {
            models = await ModelDiscovery.discover(conn);
          } catch {
            // ignore discovery errors
          }
        }
        targets = models.map((m) => ({ connection: conn, modelId: m.modelId }));
      }
    } else {
      // All connections
      const conns = ConnectionRegistry.list();
      for (const conn of conns) {
        const models = ModelCatalogStore.list(conn.providerId);
        for (const m of models) {
          targets.push({ connection: conn, modelId: m.modelId });
        }
      }
    }

    if (targets.length === 0) {
      return [];
    }

    const results: ModelProbeResult[] = [];
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const res = await ModelProbeEngine.probeModel(item.connection, item.modelId, timeoutMs);
        results.push(res);
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, targets.length) }, () => worker());
    await Promise.all(workers);

    return results;
  }
}
