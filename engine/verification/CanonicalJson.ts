import crypto from 'node:crypto';

/**
 * Strict RFC 8785 (JSON Canonicalization Scheme - JCS) implementation.
 * Ensures deterministic serialization across diverse platforms, runtimes, and languages.
 *
 * References:
 * - RFC 8785: https://www.rfc-editor.org/rfc/rfc8785.html
 */
export class CanonicalJson {
  /**
   * Validate that a string contains no lone/unpaired surrogate code units (U+D800 - U+DFFF).
   * RFC 8785 Section 3.2.2.2 forbids lone surrogates.
   */
  private static validateString(str: string): void {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        if (i + 1 >= str.length) {
          throw new TypeError('RFC 8785 violation: lone high surrogate at end of string');
        }
        const next = str.charCodeAt(i + 1);
        if (next < 0xdc00 || next > 0xdfff) {
          throw new TypeError('RFC 8785 violation: lone high surrogate not followed by low surrogate');
        }
        i++; // Valid surrogate pair
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new TypeError('RFC 8785 violation: lone low surrogate without preceding high surrogate');
      }
    }
  }

  /**
   * Serialize a number according to RFC 8785 Section 3.2.2.3 and ECMAScript specifications.
   */
  private static serializeNumber(val: number): string {
    if (!Number.isFinite(val)) {
      throw new TypeError(`RFC 8785 violation: non-finite number cannot be serialized (${val})`);
    }
    // Normalize -0 to 0
    if (Object.is(val, -0) || val === 0) {
      return '0';
    }
    return val.toString();
  }

  /**
   * Serialize a string according to RFC 8785 Section 3.2.2.2.
   * Escape only quotes, backslashes, and control characters (U+0000 - U+001F).
   */
  private static serializeString(val: string): string {
    this.validateString(val);
    return JSON.stringify(val);
  }

  /**
   * Deterministically serialize any JavaScript value according to RFC 8785 (JCS).
   * Recursively sorts object property keys strictly by UTF-16 code units.
   */
  static stringify(value: any): string {
    if (value === null) {
      return 'null';
    }

    const type = typeof value;

    if (type === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (type === 'number') {
      return this.serializeNumber(value);
    }

    if (type === 'string') {
      return this.serializeString(value);
    }

    if (type === 'bigint') {
      throw new TypeError('RFC 8785 violation: BigInt values cannot be serialized in JCS');
    }

    if (type === 'symbol' || type === 'function' || type === 'undefined') {
      return '';
    }

    if (Array.isArray(value)) {
      const items = value.map((item) => {
        const itemType = typeof item;
        if (item === undefined || itemType === 'symbol' || itemType === 'function') {
          return 'null';
        }
        return this.stringify(item);
      });
      return `[${items.join(',')}]`;
    }

    // Process object properties
    // Keys MUST be compared character-by-character based on UTF-16 code units
    const keys = Object.keys(value).sort((a, b) => {
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const entries: string[] = [];

    for (const key of keys) {
      const val = value[key];
      const valType = typeof val;

      // Skip undefined, functions, and symbols in objects
      if (val === undefined || valType === 'function' || valType === 'symbol') {
        continue;
      }

      this.validateString(key);
      const serializedKey = JSON.stringify(key);
      const serializedVal = this.stringify(val);
      entries.push(`${serializedKey}:${serializedVal}`);
    }

    return `{${entries.join(',')}}`;
  }

  /**
   * Compute deterministic SHA-256 hash of RFC 8785 canonical JSON string
   */
  static digestSha256(value: any): string {
    const canonicalStr = this.stringify(value);
    return crypto.createHash('sha256').update(canonicalStr, 'utf-8').digest('hex');
  }
}
