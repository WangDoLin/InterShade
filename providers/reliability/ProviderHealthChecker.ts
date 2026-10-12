import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import { ConnectionRegistry } from '../core/ConnectionRegistry.js';
import { ModelCatalogStore } from '../catalog/ModelCatalogStore.js';
import { NetworkGuard } from '../security/NetworkGuard.js';

export interface DiagnosticStages {
  configured: boolean;           // Has API key / valid config
  reachable: boolean;            // Network connection succeeded
  authenticated: boolean;        // API accepts credentials (not 401/403)
  modelAvailable: boolean;       // Target default model exists/accessible
  capabilitiesVerified: boolean; // Capabilities verified in catalog
}

export interface HealthCheckResult {
  connectionId: string;
  providerId: string;
  protocolId: string;
  status: 'healthy' | 'degraded' | 'auth_failed' | 'unreachable' | 'missing_config';
  stages: DiagnosticStages;
  latencyMs?: number;
  httpStatus?: number;
  message: string;
}

export class ProviderHealthChecker {
  static async check(profile: ConnectionProfile, timeoutMs = 4000): Promise<HealthCheckResult> {
    const apiKey = ConnectionRegistry.resolveApiKey(profile);

    const stages: DiagnosticStages = {
      configured: false,
      reachable: false,
      authenticated: false,
      modelAvailable: false,
      capabilitiesVerified: false,
    };

    // Stage 1: Configuration check
    const isLocal = Boolean(profile.isLocalAllowed);
    const hasKey = Boolean(apiKey || isLocal);
    stages.configured = hasKey;

    if (profile.apiKeyEnv && !apiKey && !isLocal) {
      return {
        connectionId: profile.id,
        providerId: profile.providerId,
        protocolId: profile.protocolId,
        status: 'missing_config',
        stages,
        message: `API key environment variable '${profile.apiKeyEnv}' is not configured`,
      };
    }

    // Stage 5 check (Catalog verification of default model)
    const targetModel = profile.defaultModelId;
    if (targetModel) {
      const desc = ModelCatalogStore.get(profile.providerId, targetModel);
      if (desc && desc.capabilitySource === 'verified-catalog') {
        stages.capabilitiesVerified = true;
      }
    }

    const isAnthropic = profile.providerId === 'anthropic' || profile.protocolId === 'anthropic';
    const isGoogle = profile.providerId === 'google' || profile.protocolId === 'gemini';

    let pingEndpoint: string;
    const headers: Record<string, string> = { ...profile.headers };

    if (isAnthropic) {
      const baseURL = (profile.baseURL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
      pingEndpoint = `${baseURL}/models`;
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }
      headers['anthropic-version'] = '2023-06-01';
    } else if (isGoogle) {
      const baseURL = (profile.baseURL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      pingEndpoint = `${baseURL}/models`;
      if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
      }
    } else {
      const baseURL = (profile.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
      pingEndpoint = `${baseURL}/models`;
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const response = await NetworkGuard.safeFetch(
        pingEndpoint,
        {
          method: 'GET',
          headers,
          signal: controller.signal,
        },
        { isLocalAllowed: profile.isLocalAllowed }
      );

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - start;
      stages.reachable = true;

      if (response.ok) {
        stages.authenticated = true;
        // Check if model list contains the target default model
        try {
          const body = (await response.json()) as {
            data?: Array<{ id: string }>;
            models?: Array<{ name: string }>;
          };
          let modelIds: string[] = [];
          if (Array.isArray(body.data)) {
            modelIds = body.data.map((m) => m.id);
          } else if (Array.isArray(body.models)) {
            modelIds = body.models.map((m) => m.name.replace(/^models\//, ''));
          }

          if (modelIds.length > 0 && targetModel) {
            const hasModel = modelIds.some((m) => m.toLowerCase() === targetModel.toLowerCase());
            stages.modelAvailable = hasModel;
          } else {
            stages.modelAvailable = true;
          }
        } catch {
          stages.modelAvailable = true;
        }

        const overallStatus = latencyMs > 2500 ? 'degraded' : 'healthy';
        return {
          connectionId: profile.id,
          providerId: profile.providerId,
          protocolId: profile.protocolId,
          status: overallStatus,
          stages,
          latencyMs,
          httpStatus: response.status,
          message: `Endpoint verified and ready (${response.status} OK in ${latencyMs}ms)`,
        };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          connectionId: profile.id,
          providerId: profile.providerId,
          protocolId: profile.protocolId,
          status: 'auth_failed',
          stages,
          latencyMs,
          httpStatus: response.status,
          message: `Authentication failed (HTTP ${response.status}: Unauthorized/Forbidden)`,
        };
      }

      return {
        connectionId: profile.id,
        providerId: profile.providerId,
        protocolId: profile.protocolId,
        status: 'degraded',
        stages,
        latencyMs,
        httpStatus: response.status,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      const safeErrMsg = isTimeout ? `Connection timed out after ${timeoutMs}ms` : (err instanceof Error ? err.message : 'Network error');

      return {
        connectionId: profile.id,
        providerId: profile.providerId,
        protocolId: profile.protocolId,
        status: 'unreachable',
        stages,
        message: safeErrMsg,
      };
    }
  }

  static async checkAll(profiles?: ConnectionProfile[]): Promise<HealthCheckResult[]> {
    const targets = profiles || ConnectionRegistry.list();
    return Promise.all(targets.map((p) => ProviderHealthChecker.check(p)));
  }
}
