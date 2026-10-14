import type { ConnectionProfile } from '../profiles/ProviderProfile.js';
import { BUILTIN_CONNECTIONS } from '../profiles/builtinProfiles.js';
import { ProviderError } from './ProviderErrors.js';
import { NetworkGuard } from '../security/NetworkGuard.js';
import { SecretSanitizer } from '../security/SecretSanitizer.js';

export class ConnectionRegistry {
  private static connections = new Map<string, ConnectionProfile>();
  private static defaultConnectionId: string = 'anthropic-main';

  static {
    ConnectionRegistry.seedBuiltinConnections();
  }

  static register(profile: ConnectionProfile): void {
    ConnectionRegistry.connections.set(profile.id.toLowerCase(), profile);
    if (profile.staticApiKey) {
      SecretSanitizer.registerSecret(profile.staticApiKey);
    }
  }

  static get(id: string): ConnectionProfile | undefined {
    const profile = ConnectionRegistry.connections.get(id.toLowerCase());
    if (profile && profile.providerId === 'openai' && process.env.OPENAI_BASE_URL) {
      return {
        ...profile,
        baseURL: process.env.OPENAI_BASE_URL,
        isLocalAllowed: true,
      };
    }
    return profile;
  }

  static getDefault(): ConnectionProfile {
    const configuredProvider = process.env.DEFAULT_PROVIDER?.toLowerCase();
    if (configuredProvider) {
      const matched = ConnectionRegistry.findByProvider(configuredProvider);
      if (matched) {
        return matched;
      }
    }
    const profile = ConnectionRegistry.get(ConnectionRegistry.defaultConnectionId);
    if (!profile) {
      throw new ProviderError({
        code: 'INVALID_REQUEST',
        message: `Default connection profile '${ConnectionRegistry.defaultConnectionId}' not found`,
        retryable: false,
      });
    }
    return profile;
  }

  static setDefault(id: string): void {
    if (!ConnectionRegistry.connections.has(id.toLowerCase())) {
      throw new ProviderError({
        code: 'INVALID_REQUEST',
        message: `Cannot set unknown connection profile '${id}' as default`,
        retryable: false,
      });
    }
    ConnectionRegistry.defaultConnectionId = id.toLowerCase();
  }

  static findByProvider(providerId: string): ConnectionProfile | undefined {
    if (!providerId) return undefined;
    const lower = providerId.toLowerCase();
    // Direct match (e.g., 'anthropic-main' or 'anthropic')
    let profile = ConnectionRegistry.get(lower);
    if (profile) {
      return profile;
    }
    // Match by providerId (supporting gemini/google interchangeably)
    for (const p of ConnectionRegistry.connections.values()) {
      const pId = p.providerId.toLowerCase();
      if (pId === lower || (lower === 'gemini' && pId === 'google') || (lower === 'google' && pId === 'gemini')) {
        profile = p;
        break;
      }
    }

    // Fallback: If providerId looks like a 9Router or OpenAI-compatible model (e.g. 'ag/gemini-3.8-flash-high', 'ocz/...', 'gh/...')
    if (!profile && (lower.startsWith('ag/') || lower.startsWith('ocz/') || lower.startsWith('gh/') || lower.includes('/'))) {
      const isLocalProxy = (process.env.OPENAI_BASE_URL || '').includes('20128') ||
                           (process.env.OPENAI_BASE_URL || '').includes('localhost') ||
                           (process.env.OPENAI_BASE_URL || '').includes('127.0.0.1');
      if (isLocalProxy || process.env.OPENAI_API_KEY) {
        profile = ConnectionRegistry.get('openai-main');
      }
    }

    if (profile && profile.providerId === 'openai' && process.env.OPENAI_BASE_URL) {
      return {
        ...profile,
        baseURL: process.env.OPENAI_BASE_URL,
        isLocalAllowed: true,
      };
    }
    return profile;
  }

  static resolveApiKey(profile: ConnectionProfile): string | undefined {
    if (profile.staticApiKey) {
      SecretSanitizer.registerSecret(profile.staticApiKey);
      return profile.staticApiKey;
    }
    if (profile.apiKeyEnv) {
      const val = process.env[profile.apiKeyEnv];
      if (val) {
        SecretSanitizer.registerSecret(val);
      }
      return val;
    }
    return undefined;
  }

  static validateBaseURL(profile: ConnectionProfile): void {
    if (!profile.baseURL) {
      return;
    }

    // Connect-time SSRF and scheme validation
    const parsed = NetworkGuard.validateUrl(profile.baseURL, profile.isLocalAllowed);

    if (profile.allowedHosts && profile.allowedHosts.length > 0) {
      const isAllowed = profile.allowedHosts.some(
        (allowed) => parsed.hostname.toLowerCase() === allowed.toLowerCase()
      );
      if (!isAllowed) {
        throw new ProviderError({
          code: 'INVALID_REQUEST',
          message: `Connection '${profile.id}' baseURL host '${parsed.hostname}' is not in allowedHosts list: [${profile.allowedHosts.join(', ')}]`,
          retryable: false,
        });
      }
    }
  }

  static list(): ConnectionProfile[] {
    return Array.from(ConnectionRegistry.connections.values());
  }

  private static seedBuiltinConnections(): void {
    for (const [id, profile] of Object.entries(BUILTIN_CONNECTIONS)) {
      ConnectionRegistry.connections.set(id.toLowerCase(), profile);
    }
  }
}
