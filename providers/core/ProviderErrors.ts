export type NormalizedErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'UNSUPPORTED_CAPABILITY'
  | 'ABORTED'
  | 'UNKNOWN';

export interface NormalizedProviderError {
  code: NormalizedErrorCode;
  message: string;
  statusCode?: number;
  retryable: boolean;
  rawError?: unknown;
}

import { SecretSanitizer } from '../security/SecretSanitizer.js';

export class ProviderError extends Error {
  readonly code: NormalizedErrorCode;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly rawError?: unknown;

  constructor(normalized: NormalizedProviderError) {
    const cleanMessage = SecretSanitizer.sanitize(normalized.message);
    super(cleanMessage, { cause: normalized.rawError });
    this.name = 'ProviderError';
    this.code = normalized.code;
    this.statusCode = normalized.statusCode;
    this.retryable = normalized.retryable;
    this.rawError = normalized.rawError;
    if (this.stack) {
      this.stack = SecretSanitizer.sanitize(this.stack);
    }
    if (this.rawError instanceof Error) {
      SecretSanitizer.sanitizeError(this.rawError);
    }
  }

  static fromUnknown(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      return err;
    }

    if (err instanceof Error) {
      SecretSanitizer.sanitizeError(err);
    }
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = SecretSanitizer.sanitize(rawMessage);
    const lowerMsg = message.toLowerCase();

    let code: NormalizedErrorCode = 'UNKNOWN';
    let statusCode: number | undefined;
    let retryable = false;

    if (lowerMsg.includes('abort') || lowerMsg.includes('cancelled')) {
      code = 'ABORTED';
      retryable = false;
    } else if (lowerMsg.includes('rate limit') || lowerMsg.includes('429')) {
      code = 'RATE_LIMITED';
      statusCode = 429;
      retryable = true;
    } else if (lowerMsg.includes('auth') || lowerMsg.includes('401') || lowerMsg.includes('api key')) {
      code = 'AUTH_FAILED';
      statusCode = 401;
      retryable = false;
    } else if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out')) {
      code = 'TIMEOUT';
      statusCode = 408;
      retryable = true;
    } else if (lowerMsg.includes('context length') || lowerMsg.includes('maximum context')) {
      code = 'CONTEXT_LENGTH_EXCEEDED';
      statusCode = 400;
      retryable = false;
    } else if (lowerMsg.includes('500') || lowerMsg.includes('502') || lowerMsg.includes('503')) {
      code = 'SERVER_ERROR';
      statusCode = 500;
      retryable = true;
    }

    return new ProviderError({
      code,
      message,
      statusCode,
      retryable,
      rawError: err,
    });
  }
}
