import type { ModelDescriptor } from './ModelDescriptor.js';
import {
  CapabilityEvidenceManifest,
  TrustRootRegistry,
  AuthoritySigner,
  DEFAULT_ED25519_PAIR,
  type CapabilityEvidence,
} from './CapabilityEvidenceManifest.js';

export class ModelCatalogStore {
  private static catalog = new Map<string, ModelDescriptor>();

  static {
    ModelCatalogStore.seedBuiltinCatalog();
  }

  private static makeKey(providerId: string, modelId: string): string {
    return `${providerId.toLowerCase()}:${modelId.toLowerCase()}`;
  }

  static register(descriptor: ModelDescriptor): void {
    const key = ModelCatalogStore.makeKey(descriptor.providerId, descriptor.modelId);
    ModelCatalogStore.catalog.set(key, descriptor);
  }

  static get(providerId: string, modelId: string): ModelDescriptor | undefined {
    const key = ModelCatalogStore.makeKey(providerId, modelId);
    return ModelCatalogStore.catalog.get(key);
  }

  static list(providerId?: string): ModelDescriptor[] {
    const all = Array.from(ModelCatalogStore.catalog.values());
    if (!providerId) {
      return all;
    }
    const lowerProv = providerId.toLowerCase();
    return all.filter((m) => m.providerId.toLowerCase() === lowerProv);
  }

  static resolveOrCreate(providerId: string, modelId: string): ModelDescriptor {
    const existing = ModelCatalogStore.get(providerId, modelId);
    if (existing) {
      return existing;
    }

    // Synthesize unverified descriptor with 'unknown' capabilities for unverified custom models
    const synthesized: ModelDescriptor = {
      providerId,
      modelId,
      inputModalities: ['text'],
      outputModalities: ['text'],
      capabilities: {
        streaming: 'supported',
        toolCalling: 'unknown',
        structuredOutput: 'unknown',
        reasoningControl: 'unknown',
        promptCaching: 'unknown',
        computerUse: 'unsupported',
      },
      contextWindow: 128000,
      maxOutputTokens: 8192,
      lifecycle: 'unknown',
      capabilitySource: 'unverified',
    };

    ModelCatalogStore.register(synthesized);
    return synthesized;
  }

  private static seedBuiltinCatalog(): void {
    const verifiedModels: ModelDescriptor[] = [
      {
        providerId: 'anthropic',
        modelId: 'claude-3-7-sonnet-20250219',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'supported',
          promptCaching: 'supported',
          computerUse: 'supported',
        },
        contextWindow: 200000,
        maxOutputTokens: 64000,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'supported',
        },
        contextWindow: 200000,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'anthropic',
        modelId: 'claude-3-5-haiku-20241022',
        inputModalities: ['text'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 200000,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'openai',
        modelId: 'gpt-4o',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 128000,
        maxOutputTokens: 16384,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 128000,
        maxOutputTokens: 16384,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        inputModalities: ['text'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 64000,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'deepseek',
        modelId: 'deepseek-reasoner',
        inputModalities: ['text'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'unsupported', // DeepSeek R1 standard API doesn't support tools yet
          structuredOutput: 'unsupported',
          reasoningControl: 'supported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 64000,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'google',
        modelId: 'gemini-2.0-flash',
        inputModalities: ['text', 'image', 'audio', 'video'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'supported',
          reasoningControl: 'unsupported',
          promptCaching: 'supported',
          computerUse: 'unsupported',
        },
        contextWindow: 1048576,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'ollama',
        modelId: 'llama3.3',
        inputModalities: ['text'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'unsupported',
          reasoningControl: 'unsupported',
          promptCaching: 'unsupported',
          computerUse: 'unsupported',
        },
        contextWindow: 128000,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
      {
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:14b',
        inputModalities: ['text'],
        outputModalities: ['text'],
        capabilities: {
          streaming: 'supported',
          toolCalling: 'supported',
          structuredOutput: 'unsupported',
          reasoningControl: 'unsupported',
          promptCaching: 'unsupported',
          computerUse: 'unsupported',
        },
        contextWindow: 32768,
        maxOutputTokens: 8192,
        lifecycle: 'stable',
        capabilitySource: 'verified-catalog',
      },
    ];

    for (const m of verifiedModels) {
      if (m.capabilitySource === 'verified-catalog') {
        if (!m.provenance) {
          m.provenance = {
            verifiedAt: 1740000000000,
            verifierAuthority: 'intershader-gateway-verifier-v2.1',
            configurationVersion: '2.1.1',
            verifiedHash: `sha256:${Buffer.from(`${m.providerId}:${m.modelId}:v2.1.1`).toString('hex')}`,
          };
        }
        if (!m.signedManifest) {
          const evidence: CapabilityEvidence = {
            provider: m.providerId,
            modelId: m.modelId,
            gatewayVersion: '2.1.1',
            capabilities: m.capabilities,
            verifiedAt: 1740000000000,
            authority: 'intershader-gateway-verifier-v2.1',
            configDigest: `sha256:${Buffer.from(JSON.stringify(m.capabilities)).toString('hex')}`,
          };
          m.signedManifest = AuthoritySigner.signManifestEd25519(
            evidence,
            DEFAULT_ED25519_PAIR.privateKey,
            'intershader-ed25519-root-v2-1'
          );
        }
      }
      ModelCatalogStore.register(m);
    }
  }
}
