export class SecretRedactor {
  private static readonly SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; mask: string }> = [
    // Anthropic API keys
    { name: 'Anthropic API Key', pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, mask: '[REDACTED_ANTHROPIC_KEY]' },
    // OpenAI API keys
    { name: 'OpenAI API Key', pattern: /sk-[a-zA-Z0-9_-]{20,}/g, mask: '[REDACTED_OPENAI_KEY]' },
    // Google AI Studio API keys
    { name: 'Google API Key', pattern: /AIza[0-9A-Za-z-_]{35}/g, mask: '[REDACTED_GOOGLE_KEY]' },
    // GitHub Personal Access Tokens
    { name: 'GitHub Token', pattern: /gh[pousr]_[a-zA-Z0-9]{30,}/g, mask: '[REDACTED_GITHUB_TOKEN]' },
    // AWS Access Key ID
    { name: 'AWS Access Key', pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g, mask: '[REDACTED_AWS_KEY]' },
    // Private Keys
    { name: 'Private Key', pattern: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g, mask: '[REDACTED_PRIVATE_KEY]' },
    // Generic Bearer tokens
    { name: 'Bearer Token', pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{25,}/gi, mask: 'Bearer [REDACTED_TOKEN]' },
    // JWT Tokens (3 base64 segments)
    { name: 'JWT Token', pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, mask: '[REDACTED_JWT_TOKEN]' }
  ];

  /**
   * Scans and sanitizes sensitive secrets from string content
   */
  static redact(content: string): { sanitized: string; redactedCount: number; matchedTypes: string[] } {
    if (!content) return { sanitized: '', redactedCount: 0, matchedTypes: [] };

    let sanitized = content;
    let redactedCount = 0;
    const matchedTypes: Set<string> = new Set();

    for (const rule of this.SECRET_PATTERNS) {
      const matches = sanitized.match(rule.pattern);
      if (matches) {
        redactedCount += matches.length;
        matchedTypes.add(rule.name);
        sanitized = sanitized.replace(rule.pattern, rule.mask);
      }
    }

    return {
      sanitized,
      redactedCount,
      matchedTypes: Array.from(matchedTypes)
    };
  }

  /**
   * Fast check if a string contains any secret
   */
  static containsSecret(content: string): boolean {
    if (!content) return false;
    for (const rule of this.SECRET_PATTERNS) {
      if (rule.pattern.test(content)) {
        return true;
      }
    }
    return false;
  }
}
