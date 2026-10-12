# InterShader Oracle Trust Key Lifecycle Architecture

This document establishes the production lifecycle policies and procedures for InterShader Attestation Authority Oracle signing keys, covering key generation, out-of-band distribution, routine rotation, and emergency revocation.

---

## 1. Cryptographic Key Specifications

- **Algorithm**: ECDSA over NIST P-256 (`prime256v1`, secp256r1).
- **Digest Algorithm**: SHA-256.
- **Key Encoding**:
  - Private Key: PKCS#8 PEM format (filesystem mode `0600`, restricted to running user).
  - Public Key: SubjectPublicKeyInfo (SPKI) PEM format.
- **Fingerprint Format**: 64-character lowercase SHA-256 hex digest computed over stripped base64 public key material.
- **Oracle Key Identifier**: `oracle-key-<first-12-chars-of-fingerprint>`.

---

## 2. Key Generation & Storage Boundaries

### 2.1. Isolated Keystore Boundaries
- Private keys NEVER reside inside workspace directories, git repositories, or export bundles.
- File system isolation paths:
  - Private Keys: `~/.intershader/keystore/oracle-root.pem`
  - Public Trust Root: `~/.intershader/trust/oracle-root.pub`
- In multi-tier deployments:
  - Tier 1 (Local Developer): Isolated directory keystore with strict POSIX/Windows ACL.
  - Tier 2 (Host Protected): Windows DPAPI / TPM / macOS Keychain.
  - Tier 3 (Enterprise / CI): Cloud HSM / KMS (AWS KMS, Google Cloud KMS, Azure Key Vault).

---

## 3. Key Distribution (Out-of-Band Verification)

Third-party verifiers must never trust public keys bundled inside unverified export directories. Public keys must be distributed out-of-band via trusted channels:

1. **Pre-Pinned Fingerprint**:
   - Operator sets `INTERSHADER_ORACLE_KEY_FINGERPRINT=<64-hex>` in the verification environment.
   - The verifier rejects any bundle whose signing key fingerprint does not match the pin, preventing key-substitution forgery.

2. **Decoupled Trust Store**:
   - The verifier populates `~/.intershader/trust/` from a certified internal repository or secure secret manager.
   - Public keys are stored with `.pub` extension.

3. **CI/CD Build Pipeline Verification**:
   - CI verifiers inject the expected Oracle public key as a build-time pipeline secret or container mount (`/etc/intershader/trust/`).

---

## 4. Key Rotation Procedure

To maintain continuous verification capabilities while limiting exposure windows, Oracle keys rotate on a scheduled basis (e.g. 90-day intervals):

1. **Dual-Key Overlap Window**:
   - The new public key (`oracle-root-2026Q4.pub`) is registered into verifier trust stores 14 days prior to rotation.
   - Verifiers recognize both the active key and the upcoming key during the grace period.

2. **Switch Active Signing Key**:
   - The Attestation Authority transitions to signing new Proof Manifests and `bundle-index.json` files with the new private key.

3. **Retire Old Signing Key**:
   - The old private key is securely decommissioned or archived in read-only HSM cold storage.
   - The old public key remains in the verifier Trust Store for historical verification of past immutable releases until proof TTL expires.

---

## 5. Emergency Key Revocation & Compromise Response

If a private signing key is suspected of compromise:

1. **Fingerprint Revocation**:
   - The compromised fingerprint is immediately appended to the local or remote revocation list (`~/.intershader/trust/revoked-keys.json`).
   - Verifiers evaluate candidate keys against the revocation list prior to signature verification. Any matching key is rejected immediately with `REJECT_UNTRUSTED_KEY`.

2. **Trust Store Purge**:
   - Remove the compromised `.pub` file from all active verifier environments.

3. **Attestation Blacklisting**:
   - In automated deployment gates, any artifact signed by the compromised `oracleKeyId` after the incident timestamp is blocked from deployment.

4. **Issue Fresh Keypair**:
   - Generate fresh ECDSA P-256 keypair in an isolated clean environment.
   - Distribute the new public key and fingerprint out-of-band to all consumers.
