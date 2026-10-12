export class SecretSanitizer {
  private static readonly dynamicSecrets = new Set<string>();

  private static readonly SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
    // Anthropic API keys (sk-ant-...)
    { regex: /sk-ant-[a-zA-Z0-9_\-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
    // OpenAI API keys (sk-...)
    { regex: /sk-[a-zA-Z0-9_\-]{20,}/g, replacement: '[REDACTED_API_KEY]' },
    // Google Gemini API keys (AIza...)
    { regex: /AIza[0-9A-Za-z_\-]{30,}/g, replacement: '[REDACTED_API_KEY]' },
    // Google OAuth access tokens (ya29...)
    { regex: /ya29\.[0-9A-Za-z_\-]{25,}/g, replacement: '[REDACTED_GOOGLE_TOKEN]' },
    // AWS STS session tokens (ASIA...)
    { regex: /ASIA[0-9A-Z]{16,}/g, replacement: '[REDACTED_AWS_SESSION_TOKEN]' },
    // AWS Secret Access Keys
    { regex: /((?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*)[A-Za-z0-9/+=]{40}/gi, replacement: '$1[REDACTED_AWS_SECRET_KEY]' },
    // Azure Storage / OpenAI account keys
    { regex: /((?:AccountKey|api-key)\s*[:=]\s*)[A-Za-z0-9+/=]{30,}/gi, replacement: '$1[REDACTED_AZURE_KEY]' },
    // Embedded URL credentials (e.g. https://user:pass@host/)
    { regex: /(https?:\/\/)[^:\/\s@]+:[^@\/\s]+@/gi, replacement: '$1[REDACTED_AUTH]@' },
    // Bearer authorization tokens
    { regex: /Bearer\s+[a-zA-Z0-9_\-\.]{16,}/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
    // Authorization headers in HTTP dumps
    { regex: /(authorization:\s*)[^\r\n]+/gi, replacement: '$1[REDACTED_AUTH_HEADER]' },
    // Query string API keys or secrets
    { regex: /((?:api_?key|token|secret|password)=)[a-zA-Z0-9_\-\.]{8,}/gi, replacement: '$1[REDACTED_SECRET]' },
  ];

  /**
   * Register a sensitive token, password, or key for dynamic redaction across the gateway.
   * Supports both short secrets (3-7 characters) with boundary-aware matching and long credentials.
   */
  static registerSecret(secret: string): void {
    if (secret && typeof secret === 'string' && secret.trim().length >= 3) {
      SecretSanitizer.dynamicSecrets.add(secret.trim());
    }
  }

  /**
   * Clear all registered dynamic secrets (primarily for testing teardown)
   */
  static clearRegisteredSecrets(): void {
    SecretSanitizer.dynamicSecrets.clear();
  }

  /**
   * Dual-Tier Sanitization:
   * Tier 1: Exact Registered-Secret Redaction (boundary-safe for short 3-7 char keys, exact for >= 8 chars)
   * Tier 2: Heuristic Regex Entropy Patterns (>= 16 chars for cloud/API credentials)
   */
  static sanitize(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }
    let sanitized = text;

    // Tier 1: Scrub dynamically registered secrets
    for (const secret of SecretSanitizer.dynamicSecrets) {
      if (secret.length >= 8) {
        if (sanitized.includes(secret)) {
          sanitized = sanitized.replaceAll(secret, '[REDACTED_REGISTERED_SECRET]');
        }
      } else {
        // Boundary-aware matching for short secrets (3-7 chars) using zero-width lookaround assertions.
        // Prevents consuming boundary characters so contiguous or adjacent secrets (e.g. PIN42,PIN42 or {"a":"PIN42","b":"PIN42"}) are not skipped.
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const lookaroundRegex = new RegExp(`(?<=^|[^a-zA-Z0-9_])${escaped}(?=[^a-zA-Z0-9_]|$)`, 'g');
        sanitized = sanitized.replace(lookaroundRegex, '[REDACTED_REGISTERED_SECRET]');
      }
    }

    // Tier 2: Scrub regex patterns
    for (const pattern of SecretSanitizer.SECRET_PATTERNS) {
      sanitized = sanitized.replace(pattern.regex, pattern.replacement);
    }
    return sanitized;
  }

  /**
   * Deep sanitize all string values in an object or array
   */
  static sanitizeObject<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === 'string') {
      return SecretSanitizer.sanitize(value) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => SecretSanitizer.sanitizeObject(item)) as unknown as T;
    }
    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = SecretSanitizer.sanitizeObject(val);
      }
      return result as T;
    }
    return value;
  }

  /**
   * Recursively sanitize an Error instance including message, stack, cause, and AggregateError children
   */
  static sanitizeError<T extends Error>(err: T): T {
    if (!err) return err;
    if (typeof err.message === 'string') {
      const sanitized = SecretSanitizer.sanitize(err.message);
      try {
        err.message = sanitized;
      } catch {
        try {
          Object.defineProperty(err, 'message', {
            value: sanitized,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch {
          // Non-configurable property
        }
      }
    }
    if (typeof err.stack === 'string') {
      const sanitizedStack = SecretSanitizer.sanitize(err.stack);
      try {
        err.stack = sanitizedStack;
      } catch {
        try {
          Object.defineProperty(err, 'stack', {
            value: sanitizedStack,
            writable: true,
            configurable: true,
            enumerable: false,
          });
        } catch {
          // Non-configurable property
        }
      }
    }
    const anyErr = err as unknown as { cause?: unknown; errors?: unknown[] };
    if (anyErr.cause) {
      if (anyErr.cause instanceof Error) {
        SecretSanitizer.sanitizeError(anyErr.cause);
      } else if (typeof anyErr.cause === 'string') {
        anyErr.cause = SecretSanitizer.sanitize(anyErr.cause);
      }
    }
    if (Array.isArray(anyErr.errors)) {
      for (const subErr of anyErr.errors) {
        if (subErr instanceof Error) {
          SecretSanitizer.sanitizeError(subErr);
        }
      }
    }
    return err;
  }

  /**
   * Check if text contains an unredacted secret
   */
  static containsSecret(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }
    for (const secret of SecretSanitizer.dynamicSecrets) {
      if (text.includes(secret)) {
        return true;
      }
    }
    for (const pattern of SecretSanitizer.SECRET_PATTERNS) {
      // Create a per-call copy to avoid shared lastIndex state from the global regex
      const testRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
      if (testRegex.test(text)) {
        return true;
      }
    }
    return false;
  }
}
