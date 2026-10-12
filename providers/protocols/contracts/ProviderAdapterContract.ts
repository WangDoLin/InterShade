import type { LanguageModel, ModelRequest, UnifiedStreamEvent } from '../../core/BaseModel.js';
import type { ModelDescriptor } from '../../catalog/ModelDescriptor.js';
import { CapabilityNegotiator } from '../../core/CapabilityNegotiator.js';
import { CapabilityEvidenceManifest } from '../../catalog/CapabilityEvidenceManifest.js';
import { ToolExecutionGate, TurnBudgetTracker } from '../../security/ToolExecutionGate.js';
import { NetworkGuard } from '../../security/NetworkGuard.js';
import { SecretSanitizer } from '../../security/SecretSanitizer.js';
import { ProviderError } from '../../core/ProviderErrors.js';

export interface ProviderAdapterConfig {
  providerId: string;
  endpoint: string;
  credentials?: Record<string, string | undefined>;
  isLocalAllowed?: boolean;
  maxRetries?: number;
}

export interface AdapterStreamOptions {
  turnBudget?: TurnBudgetTracker;
}

/**
 * Standard Provider Adapter Contract for Phase P3 cloud integrations
 * (Azure OpenAI, Vertex AI, AWS Bedrock Converse).
 *
 * Guarantees that every new provider inherits all gateway security gates,
 * capability provenance, IP pinning, active upstream cancellation,
 * and turn budget invariants.
 */
export abstract class BaseProviderAdapter implements LanguageModel {
  abstract readonly descriptor: ModelDescriptor;
  protected readonly config: ProviderAdapterConfig;

  constructor(config: ProviderAdapterConfig) {
    this.config = config;
    if (config.credentials) {
      this.registerCredentials(config.credentials);
    }
  }

  /**
   * Automatically register sensitive API keys, session tokens, or private secrets
   * into SecretSanitizer to guarantee zero leakage in errors or logs.
   */
  protected registerCredentials(credentials: Record<string, string | undefined>): void {
    for (const val of Object.values(credentials)) {
      if (val && typeof val === 'string' && val.trim().length >= 3) {
        SecretSanitizer.registerSecret(val.trim());
      }
    }
  }

  /**
   * Pre-flight verification:
   * 1. Evaluates capability eligibility and provenance manifest
   * 2. Checks AbortSignal
   * 3. Rejects unsupported tool requests
   */
  protected validatePreflight(request: ModelRequest): void {
    if (request.signal?.aborted) {
      throw new ProviderError({
        code: 'ABORTED',
        message: 'REJECT_ABORTED: Request was aborted before execution',
        retryable: false,
      });
    }

    // Capability and provenance verification
    const evalResult = CapabilityNegotiator.evaluate(this.descriptor, {
      toolCalling: request.tools && request.tools.length > 0 ? 'required' : 'optional',
    });

    if (!evalResult.eligible) {
      throw new ProviderError({
        code: 'UNSUPPORTED_CAPABILITY',
        message: `REJECT_INELIGIBLE_MODEL: Model '${this.descriptor.modelId}' does not satisfy required capabilities: ${evalResult.rejectionReasons.join('; ')}`,
        retryable: false,
      });
    }

    if (this.descriptor.signedManifest) {
      const verifyResult = CapabilityEvidenceManifest.verifyManifest(this.descriptor.signedManifest);
      if (!verifyResult.valid) {
        throw new ProviderError({
          code: 'UNSUPPORTED_CAPABILITY',
          message: `REJECT_INVALID_PROVENANCE: Model capability manifest verification failed: ${verifyResult.reason}`,
          retryable: false,
        });
      }
    }
  }

  /**
   * Outbound network dispatch:
   * Enforces NetworkGuard safeFetch with socket-level IP pinning and agent: false socket isolation.
   */
  protected async executeSafeOutbound(
    url: string,
    init: RequestInit = {},
    options?: { dnsResolver?: (host: string) => Promise<string[]> }
  ): Promise<Response> {
    return NetworkGuard.safeFetch(url, init, {
      isLocalAllowed: this.config.isLocalAllowed ?? false,
      dnsResolver: options?.dnsResolver,
    });
  }

  /**
   * Wrap raw stream with ToolExecutionGate to enforce:
   * 1. 5 MB individual payload limit
   * 2. 10 MB turn aggregate budget across model iterations/fallbacks
   * 3. 32 tool count turn quota
   * 4. Active upstream stream cancellation on abort
   */
  protected wrapStreamWithSecurity(
    stream: AsyncIterable<UnifiedStreamEvent>,
    request: ModelRequest,
    options: AdapterStreamOptions = {}
  ): AsyncGenerator<UnifiedStreamEvent> {
    return ToolExecutionGate.wrapStream(stream, request.tools, {
      turnBudget: options.turnBudget,
    });
  }

  /**
   * Normalize any error with recursive secret redaction
   */
  protected normalizeError(err: unknown): ProviderError {
    return ProviderError.fromUnknown(err);
  }

  /**
   * Main stream generation contract
   */
  abstract stream(
    request: ModelRequest,
    options?: AdapterStreamOptions
  ): AsyncGenerator<UnifiedStreamEvent, void, unknown>;
}
