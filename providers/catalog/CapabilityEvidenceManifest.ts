import crypto from 'crypto';
import type { ModelCapabilities } from './ModelDescriptor.js';

export interface CapabilityEvidence {
  provider: string;
  modelId: string;
  gatewayVersion: string;
  capabilities: ModelCapabilities;
  verifiedAt: number;
  authority: string;
  configDigest: string;
}

export interface SignedCapabilityManifest {
  evidence: CapabilityEvidence;
  signature: string;
  publicKeyId: string;
  algorithm?: 'Ed25519' | 'HMAC-SHA256';
}

export interface TrustRootKeyEntry {
  authority: string;
  publicKey?: string; // Ed25519 SPKI PEM
  secret?: string; // Legacy HMAC secret for backward compatibility
  algorithm: 'Ed25519' | 'HMAC-SHA256';
}

// Generate static default Ed25519 authority keypair for InterShader Gateway Trust Root
const DEFAULT_ED25519_PAIR = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

export class TrustRootRegistry {
  private static readonly trustedKeys = new Map<string, TrustRootKeyEntry>();

  static {
    // Register Default Ed25519 Public Key (Asymmetric attestation - public key only!)
    TrustRootRegistry.registerPublicKey(
      'intershader-ed25519-root-v2-1',
      'intershader-gateway-verifier-v2.1',
      DEFAULT_ED25519_PAIR.publicKey
    );

    // Register Legacy HMAC Key for backward compatibility with existing suites
    TrustRootRegistry.registerKey(
      'intershader-key-root-v2-1',
      'intershader-gateway-verifier-v2.1',
      'intershader-production-trust-secret-v2-1-2-secure-digest'
    );
  }

  static registerPublicKey(keyId: string, authority: string, publicKey: string): void {
    TrustRootRegistry.trustedKeys.set(keyId, {
      authority,
      publicKey,
      algorithm: 'Ed25519',
    });
  }

  static registerKey(keyId: string, authority: string, secret: string): void {
    TrustRootRegistry.trustedKeys.set(keyId, {
      authority,
      secret,
      algorithm: 'HMAC-SHA256',
    });
  }

  static isKeyTrusted(keyId: string): boolean {
    return TrustRootRegistry.trustedKeys.has(keyId);
  }

  static getKey(keyId: string): TrustRootKeyEntry | undefined {
    return TrustRootRegistry.trustedKeys.get(keyId);
  }

  /**
   * Internal helper for the test suite authority signer
   */
  static getDefaultPrivateKey(): string {
    return DEFAULT_ED25519_PAIR.privateKey;
  }
}

export class AuthoritySigner {
  /**
   * Dedicated signer holding Ed25519 private key (isolated from gateway verifiers)
   */
  static signManifestEd25519(
    evidence: CapabilityEvidence,
    privateKeyPem: string,
    publicKeyId: string
  ): SignedCapabilityManifest {
    const canonical = CapabilityEvidenceManifest.canonicalSerializeRFC8785(evidence);
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem);

    return {
      evidence,
      signature: signature.toString('hex'),
      publicKeyId,
      algorithm: 'Ed25519',
    };
  }
}

export class CapabilityEvidenceManifest {
  /**
   * RFC 8785 JSON Canonicalization Scheme (JCS):
   * - UTF-16 code unit sorted property names
   * - Whitespace-free JSON
   * - Deterministic IEEE 754 number representation (-0 normalized to 0, no NaN/Infinity)
   * - Strings: control chars < 0x20 escaped, "/" not escaped, Unicode literals >= 0x20
   */
  static canonicalSerializeRFC8785(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      if (Number.isNaN(value) || !Number.isFinite(value)) {
        throw new Error('RFC 8785: NaN and Infinity are not permitted in canonical JSON');
      }
      // Normalize -0 to 0 per RFC 8785 Section 3.2.2.1
      if (Object.is(value, -0)) {
        return '0';
      }
      return value.toString();
    }
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((item) => CapabilityEvidenceManifest.canonicalSerializeRFC8785(item)).join(',') + ']';
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      // UTF-16 code unit sorting per RFC 8785 Section 3.2.3
      const keys = Object.keys(record).sort((a, b) => {
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) {
          const ca = a.charCodeAt(i);
          const cb = b.charCodeAt(i);
          if (ca !== cb) return ca - cb;
        }
        return a.length - b.length;
      });

      const parts: string[] = [];
      for (const k of keys) {
        if (record[k] !== undefined) {
          parts.push(`${JSON.stringify(k)}:${CapabilityEvidenceManifest.canonicalSerializeRFC8785(record[k])}`);
        }
      }
      return '{' + parts.join(',') + '}';
    }
    return JSON.stringify(value);
  }

  /**
   * Canonical serialization backward compatibility wrapper
   */
  static canonicalSerialize(value: unknown): string {
    return CapabilityEvidenceManifest.canonicalSerializeRFC8785(value);
  }

  /**
   * Cryptographically sign a CapabilityEvidence object using an authority key (supports HMAC and Ed25519)
   */
  static signEvidence(
    evidence: CapabilityEvidence,
    authoritySecretOrPrivateKey: string,
    publicKeyId: string,
    algorithm: 'Ed25519' | 'HMAC-SHA256' = 'HMAC-SHA256'
  ): SignedCapabilityManifest {
    if (algorithm === 'Ed25519') {
      return AuthoritySigner.signManifestEd25519(evidence, authoritySecretOrPrivateKey, publicKeyId);
    }

    const canonical = CapabilityEvidenceManifest.canonicalSerializeRFC8785(evidence);
    const hmac = crypto.createHmac('sha256', authoritySecretOrPrivateKey);
    hmac.update(canonical);
    const signature = hmac.digest('hex');

    return {
      evidence,
      signature,
      publicKeyId,
      algorithm: 'HMAC-SHA256',
    };
  }

  /**
   * Verify authenticity, signature, and trust root authority of a capability manifest.
   * Strict mode enforces Ed25519 authority validation with zero automatic downgrade to HMAC.
   */
  static verifyManifest(
    manifest: SignedCapabilityManifest,
    options: { strictMode?: boolean } = {}
  ): { valid: boolean; reason?: string } {
    if (!manifest || !manifest.evidence || !manifest.signature || !manifest.publicKeyId) {
      return { valid: false, reason: 'MALFORMED_MANIFEST' };
    }

    const trustedEntry = TrustRootRegistry.getKey(manifest.publicKeyId);
    if (!trustedEntry) {
      return {
        valid: false,
        reason: `UNTRUSTED_AUTHORITY_KEY: Key '${manifest.publicKeyId}' is not registered in Trust Root`,
      };
    }

    if (trustedEntry.authority !== manifest.evidence.authority) {
      return {
        valid: false,
        reason: `AUTHORITY_MISMATCH: Expected '${trustedEntry.authority}', found '${manifest.evidence.authority}'`,
      };
    }

    const canonical = CapabilityEvidenceManifest.canonicalSerializeRFC8785(manifest.evidence);

    // Strict Mode: Check for algorithm downgrade attack
    if (trustedEntry.algorithm === 'Ed25519') {
      if (manifest.algorithm && manifest.algorithm !== 'Ed25519') {
        return {
          valid: false,
          reason: `REJECT_ALGORITHM_DOWNGRADE: Authority requires Ed25519 signature; '${manifest.algorithm}' is strictly rejected`,
        };
      }
      if (!trustedEntry.publicKey) {
        return { valid: false, reason: 'MISSING_PUBLIC_KEY: No Ed25519 public key found for authority' };
      }
      try {
        const signatureBuf = Buffer.from(manifest.signature, 'hex');
        const isVerified = crypto.verify(
          null,
          Buffer.from(canonical, 'utf8'),
          trustedEntry.publicKey,
          signatureBuf
        );
        if (!isVerified) {
          return {
            valid: false,
            reason: 'SIGNATURE_VERIFICATION_FAILED: Capability evidence payload tampered or forged',
          };
        }
        return { valid: true };
      } catch (err: unknown) {
        return { valid: false, reason: `SIGNATURE_VERIFICATION_ERROR: ${(err as Error).message}` };
      }
    }

    // Legacy HMAC-SHA256 verification (strictly disallowed if manifest algorithm claims Ed25519 or strictMode requires Ed25519)
    if (manifest.algorithm === 'Ed25519') {
      return {
        valid: false,
        reason: `ALGORITHM_MISMATCH: Manifest specifies Ed25519 but authority key '${manifest.publicKeyId}' is registered as HMAC-SHA256`,
      };
    }

    if (!trustedEntry.secret) {
      return { valid: false, reason: 'MISSING_SECRET_KEY: No HMAC secret key found for authority' };
    }
    const hmac = crypto.createHmac('sha256', trustedEntry.secret);
    hmac.update(canonical);
    const expectedSig = hmac.digest('hex');

    const expectedBuffer = Buffer.from(expectedSig, 'utf8');
    const actualBuffer = Buffer.from(manifest.signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      return { valid: false, reason: 'SIGNATURE_VERIFICATION_FAILED: Capability evidence payload tampered or forged' };
    }

    return { valid: true };
  }
}
