import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CanonicalJson } from './CanonicalJson.js';
import { IsolatedKeystore } from './IsolatedKeystore.js';
import type { SignedBundleIndex } from './EvidenceStore.js';

export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const DEFAULT_MAX_BUNDLE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB
export const DEFAULT_MAX_FILE_COUNT = 1000;
export const DEFAULT_MAX_INDEX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const DEFAULT_MAX_DISK_ENTRIES = 1000;

export type StandaloneVerifierVerdict =
  | 'ACCEPT'
  | 'REJECT_MODIFIED_EXPORT'
  | 'REJECT_MODIFIED_INDEX'
  | 'REJECT_UNTRUSTED_KEY'
  | 'REJECT_MISSING_EXPORT'
  | 'REJECT_UNLISTED_EXPORT'
  | 'REJECT_STALE_OR_MISMATCHED_MANIFEST'
  | 'REJECT_DANGEROUS_PATH'
  | 'REJECT_RESOURCE_LIMIT_EXCEEDED'
  | 'REJECT_INVALID_STRUCTURE';

export interface StandaloneVerifyOptions {
  trustedRootKeyPem?: string;
  trustStoreDir?: string;
  expectedManifestHash?: string;
  allowUnlisted?: boolean;
  enforceTrustStore?: boolean;
  pinnedFingerprint?: string;
  stageToDir?: string;
  maxFileSizeBudget?: number;
  maxBundleSizeBudget?: number;
  maxFileCount?: number;
  maxIndexSizeBudget?: number;
  maxDiskEntries?: number;
}

/**
 * Immutable in-memory container for verified artifact buffers.
 * Enforces defensive byte copying so downstream consumers cannot mutate
 * the internal verified state or tamper with cryptographic proofs in memory.
 */
export class VerifiedArtifactStore {
  private readonly buffers: Map<string, Buffer>;

  constructor(buffers?: Map<string, Buffer>) {
    this.buffers = new Map();
    if (buffers) {
      for (const [k, v] of buffers.entries()) {
        this.buffers.set(k, Buffer.from(v));
      }
    }
  }

  set(filename: string, buffer: Buffer): void {
    this.buffers.set(filename, Buffer.from(buffer));
  }

  getBuffer(filename: string): Buffer | undefined {
    const buf = this.buffers.get(filename);
    return buf ? Buffer.from(buf) : undefined;
  }

  has(filename: string): boolean {
    return this.buffers.has(filename);
  }

  get size(): number {
    return this.buffers.size;
  }

  filenames(): string[] {
    return Array.from(this.buffers.keys());
  }

  verifyDigest(filename: string, expectedSha256: string): boolean {
    const buf = this.buffers.get(filename);
    if (!buf) return false;
    const computed = crypto.createHash('sha256').update(buf).digest('hex');
    return computed === expectedSha256;
  }

  toMap(): Map<string, Buffer> {
    const map = new Map<string, Buffer>();
    for (const [k, v] of this.buffers.entries()) {
      map.set(k, Buffer.from(v));
    }
    return map;
  }

  /**
   * Consume a verified buffer directly via callback in memory (Invariant B).
   * Caller receives verified bytes without exposing internal mutable reference,
   * avoiding disk re-read TOCTOU gaps.
   */
  consumeBuffer<T>(filename: string, consumer: (buf: Buffer) => T): T {
    const buf = this.buffers.get(filename);
    if (!buf) {
      throw new Error(`Artifact "${filename}" not found in verified store`);
    }
    return consumer(Buffer.from(buf));
  }

  /**
   * Consume all verified buffers directly in memory (Invariant B).
   */
  consumeAll<T>(consumer: (files: Map<string, Buffer>) => T): T {
    return consumer(this.toMap());
  }
}

export interface StandaloneVerificationResult {
  isAccepted: boolean;
  verdict: StandaloneVerifierVerdict;
  reason: string;
  errors: string[];
  details: {
    bundleDigest?: string;
    filesChecked: number;
    oracleKeyId?: string;
    keyFingerprint?: string;
    tamperedFiles?: string[];
    missingFiles?: string[];
    unlistedFiles?: string[];
  };
  verifiedBuffers?: Map<string, Buffer>;
  artifactStore?: VerifiedArtifactStore;
  stagedPath?: string;
}

/**
 * StandaloneVerifier: Independent verification engine for Signed Export Bundles.
 * Decoupled from bundle creation logic and runtime memory caches.
 *
 * Threat Model & Security Invariants:
 * - Employs verified-byte cryptographic binding with descriptor-level invariant checks.
 * - Enforces pre-open boundary validation and regular-file constraints.
 * - On POSIX: Uses O_NOFOLLOW and asserts inode/device invariants between lstat and open.
 * - On Windows: Detects path divergence and reparse points via realpath.native() invariants.
 * - Invariant Guarantee: Downstream execution relies strictly on in-memory verified bytes
 *   whose SHA-256 digests are cryptographically anchored to an ECDSA-signed Trust Root.
 *   Filesystem mutations or symlink swaps during or after verification cannot alter verified bytes.
 */
export class StandaloneVerifier {
  /**
   * Verify whether a filename contains directory traversal or dangerous path components.
   */
  static isDangerousPath(targetPath: string): boolean {
    if (!targetPath || typeof targetPath !== 'string') return true;
    if (targetPath.includes('..')) return true;
    if (targetPath.includes('/') || targetPath.includes('\\')) return true;
    if (path.isAbsolute(targetPath)) return true;
    if (/^[a-zA-Z]:/.test(targetPath)) return true; // Windows drive letter
    return false;
  }

  /**
   * Safely open and read a regular file using a file descriptor with cross-platform TOCTOU defense.
   * - Enforces pre-open symlink/reparse point checks.
   * - On POSIX: Uses O_NOFOLLOW and asserts inode/device invariants between lstat and open.
   * - On Windows: Verifies native realpath stability and size/mtime invariants.
   * - Reads directly from the verified file descriptor into memory via short-read resilient loop.
   * - Enforces maximum file size safety budget.
   */
  static readRegularFileDescriptor(
    filePath: string,
    canonicalExportsDir: string,
    maxFileSizeBudget: number = DEFAULT_MAX_FILE_SIZE_BYTES
  ): { buffer: Buffer; error?: string; isDangerous?: boolean; isMissing?: boolean; isResourceExceeded?: boolean } {
    if (!fs.existsSync(filePath)) {
      return { buffer: Buffer.alloc(0), isMissing: true };
    }

    let lstat: fs.Stats;
    try {
      lstat = fs.lstatSync(filePath);
    } catch (err: any) {
      return { buffer: Buffer.alloc(0), error: err.message };
    }

    // Explicitly reject symbolic links and reparse points
    if (lstat.isSymbolicLink()) {
      return {
        buffer: Buffer.alloc(0),
        error: `Symbolic link is forbidden by security policy: ${path.basename(filePath)}`,
        isDangerous: true,
      };
    }

    // Require regular file
    if (!lstat.isFile()) {
      return {
        buffer: Buffer.alloc(0),
        error: `Non-regular file entry forbidden: ${path.basename(filePath)}`,
        isDangerous: true,
      };
    }

    // Verify canonical path containment inside exportsDir
    let canonicalFilePath: string;
    try {
      canonicalFilePath = (fs.realpathSync as any).native
        ? (fs.realpathSync as any).native(filePath)
        : fs.realpathSync(filePath);
    } catch (err: any) {
      return { buffer: Buffer.alloc(0), error: err.message, isDangerous: true };
    }

    const relative = path.relative(canonicalExportsDir, canonicalFilePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return {
        buffer: Buffer.alloc(0),
        error: `File path escapes exports trust boundary: ${filePath} -> ${canonicalFilePath}`,
        isDangerous: true,
      };
    }

    // Use O_NOFOLLOW on POSIX where available
    const openFlags =
      fs.constants.O_RDONLY |
      (process.platform !== 'win32' && (fs.constants as any).O_NOFOLLOW
        ? (fs.constants as any).O_NOFOLLOW
        : 0);

    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, openFlags);
      const fstat = fs.fstatSync(fd);
      if (!fstat.isFile()) {
        return {
          buffer: Buffer.alloc(0),
          error: `Opened descriptor is not a regular file: ${filePath}`,
          isDangerous: true,
        };
      }

      // Enforce file size budget
      if (fstat.size > maxFileSizeBudget) {
        return {
          buffer: Buffer.alloc(0),
          error: `File size exceeds safety budget (${fstat.size} > ${maxFileSizeBudget} bytes): ${path.basename(filePath)}`,
          isResourceExceeded: true,
        };
      }

      // Assert invariant equality between pre-open lstat and post-open fstat
      if (fstat.size !== lstat.size) {
        return {
          buffer: Buffer.alloc(0),
          error: `TOCTOU race detected: file size changed during open (${lstat.size} -> ${fstat.size})`,
          isDangerous: true,
        };
      }

      if (Math.abs(fstat.mtimeMs - lstat.mtimeMs) > 50) {
        return {
          buffer: Buffer.alloc(0),
          error: `TOCTOU race detected: file modification time changed during open`,
          isDangerous: true,
        };
      }

      // POSIX file identity check: verify inode and device numbers are identical
      if (process.platform !== 'win32') {
        if (fstat.ino !== lstat.ino || fstat.dev !== lstat.dev) {
          return {
            buffer: Buffer.alloc(0),
            error: `TOCTOU file substitution attack detected: inode/device mismatch between lstat and open (inode ${lstat.ino} -> ${fstat.ino})`,
            isDangerous: true,
          };
        }
      } else {
        // Windows check: verify native realpath stability post-open to detect reparse point swaps
        let postOpenReal: string;
        try {
          postOpenReal = (fs.realpathSync as any).native
            ? (fs.realpathSync as any).native(filePath)
            : fs.realpathSync(filePath);
        } catch {
          postOpenReal = canonicalFilePath;
        }

        if (postOpenReal.toLowerCase() !== canonicalFilePath.toLowerCase()) {
          return {
            buffer: Buffer.alloc(0),
            error: `Windows reparse point/junction substitution detected during open: ${filePath} -> ${postOpenReal}`,
            isDangerous: true,
          };
        }
      }

      // Safe short-read resilient sequential read loop
      const buf = Buffer.alloc(fstat.size);
      let offset = 0;
      while (offset < fstat.size) {
        const bytesRead = fs.readSync(
          fd,
          buf,
          offset,
          fstat.size - offset,
          offset
        );
        if (bytesRead === 0) {
          return {
            buffer: Buffer.alloc(0),
            error: `Unexpected EOF while reading descriptor: expected ${fstat.size} bytes, got ${offset}`,
            isDangerous: true,
          };
        }
        offset += bytesRead;
      }

      if (offset !== fstat.size) {
        return {
          buffer: Buffer.alloc(0),
          error: `Incomplete read: expected ${fstat.size} bytes, got ${offset}`,
          isDangerous: true,
        };
      }

      return { buffer: buf };
    } catch (err: any) {
      return { buffer: Buffer.alloc(0), error: err.message };
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore close error
        }
      }
    }
  }

  /**
   * Verify an ECDSA SHA-256 digital signature against a public key.
   */
  static verifySignature(digestSha256: string, signatureHex: string, publicKeyPem: string): boolean {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(Buffer.from(digestSha256, 'hex'));
      verify.end();
      return verify.verify(publicKeyPem, signatureHex, 'hex');
    } catch {
      return false;
    }
  }

  /**
   * Execute independent verification on a target export directory.
   */
  static verifyExportBundle(
    exportsDirPath: string,
    options?: StandaloneVerifyOptions
  ): StandaloneVerificationResult {
    const errors: string[] = [];

    // 1. Structure check: Directory presence
    if (!fs.existsSync(exportsDirPath) || !fs.statSync(exportsDirPath).isDirectory()) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: `Target exports directory does not exist or is not a directory: ${exportsDirPath}`,
        errors: [`Invalid directory path: ${exportsDirPath}`],
        details: { filesChecked: 0 },
      };
    }

    let canonicalExportsDir: string;
    try {
      canonicalExportsDir = (fs.realpathSync as any).native
        ? (fs.realpathSync as any).native(exportsDirPath)
        : fs.realpathSync(exportsDirPath);
    } catch (err: any) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: `Unable to resolve realpath for exports directory: ${err.message}`,
        errors: [err.message],
        details: { filesChecked: 0 },
      };
    }

    const maxFileSize = options?.maxFileSizeBudget ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    const maxBundleSize = options?.maxBundleSizeBudget ?? DEFAULT_MAX_BUNDLE_SIZE_BYTES;
    const maxFileCount = options?.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
    const maxIndexSize = options?.maxIndexSizeBudget ?? DEFAULT_MAX_INDEX_SIZE_BYTES;
    const maxDiskEntries = options?.maxDiskEntries ?? DEFAULT_MAX_DISK_ENTRIES;
    let accumulatedBundleBytes = 0;

    // 2. Scan physical files on disk for path safety, symlinks, containment, and entry count
    let diskEntries: string[] = [];
    try {
      diskEntries = fs.readdirSync(exportsDirPath);
    } catch (err: any) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: `Unable to read directory: ${err.message}`,
        errors: [err.message],
        details: { filesChecked: 0 },
      };
    }

    if (diskEntries.length > maxDiskEntries) {
      return {
        isAccepted: false,
        verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
        reason: `Exports directory contains too many entries (${diskEntries.length} > ${maxDiskEntries})`,
        errors: [`Disk entry count limit exceeded: ${diskEntries.length}`],
        details: { filesChecked: 0 },
      };
    }

    for (const entry of diskEntries) {
      if (this.isDangerousPath(entry)) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `Dangerous path detected in exports directory: "${entry}"`,
          errors: [`Path traversal or illegal filename: ${entry}`],
          details: { filesChecked: 0 },
        };
      }

      const fullEntryPath = path.join(exportsDirPath, entry);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fullEntryPath);
      } catch (err: any) {
        return {
          isAccepted: false,
          verdict: 'REJECT_INVALID_STRUCTURE',
          reason: `Failed to stat file "${entry}": ${err.message}`,
          errors: [err.message],
          details: { filesChecked: 0 },
        };
      }

      if (lstat.isSymbolicLink()) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `Symbolic link detected and forbidden by security policy: "${entry}"`,
          errors: [`Forbidden symbolic link: ${entry}`],
          details: { filesChecked: 0 },
        };
      }

      if (!lstat.isFile()) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `Non-regular file entry detected in exports directory: "${entry}"`,
          errors: [`Non-regular file forbidden: ${entry}`],
          details: { filesChecked: 0 },
        };
      }

      let canonicalEntryPath: string;
      try {
        canonicalEntryPath = (fs.realpathSync as any).native
          ? (fs.realpathSync as any).native(fullEntryPath)
          : fs.realpathSync(fullEntryPath);
      } catch (err: any) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `Failed to resolve realpath for "${entry}": ${err.message}`,
          errors: [err.message],
          details: { filesChecked: 0 },
        };
      }

      const rel = path.relative(canonicalExportsDir, canonicalEntryPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `File path escapes exports trust boundary: "${entry}" -> "${canonicalEntryPath}"`,
          errors: [`Path boundary escape detected: ${entry}`],
          details: { filesChecked: 0 },
        };
      }
    }

    // 3. Locate and safely read bundle-index.json (strictly bounded by maxIndexSize)
    const indexPath = path.join(exportsDirPath, 'bundle-index.json');
    const readIndex = this.readRegularFileDescriptor(indexPath, canonicalExportsDir, maxIndexSize);
    if (readIndex.isMissing) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: 'Missing bundle-index.json in exports directory. Bundle is unsigned or incomplete.',
        errors: ['bundle-index.json not found'],
        details: { filesChecked: 0 },
      };
    }
    if (readIndex.isResourceExceeded) {
      return {
        isAccepted: false,
        verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
        reason: readIndex.error || `bundle-index.json size exceeds budget (${maxIndexSize} bytes)`,
        errors: [readIndex.error || 'Index size budget exceeded'],
        details: { filesChecked: 0 },
      };
    }
    if (readIndex.isDangerous) {
      return {
        isAccepted: false,
        verdict: 'REJECT_DANGEROUS_PATH',
        reason: readIndex.error || 'Dangerous bundle-index.json path',
        errors: [readIndex.error || 'Dangerous bundle-index.json path'],
        details: { filesChecked: 0 },
      };
    }
    if (readIndex.error) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: `Failed to read bundle-index.json: ${readIndex.error}`,
        errors: [readIndex.error],
        details: { filesChecked: 0 },
      };
    }
    accumulatedBundleBytes += readIndex.buffer.length;

    let bundleIndex: SignedBundleIndex;
    try {
      bundleIndex = JSON.parse(readIndex.buffer.toString('utf-8'));
    } catch (err: any) {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: `Invalid bundle-index.json syntax: ${err.message}`,
        errors: [`JSON parse failure: ${err.message}`],
        details: { filesChecked: 0 },
      };
    }

    if (!bundleIndex.files || typeof bundleIndex.files !== 'object') {
      return {
        isAccepted: false,
        verdict: 'REJECT_INVALID_STRUCTURE',
        reason: 'bundle-index.json missing "files" map.',
        errors: ['Invalid schema: files property missing or malformed'],
        details: { filesChecked: 0 },
      };
    }

    // 4. Validate all declared file names in bundle index against path traversal
    for (const declaredName of Object.keys(bundleIndex.files)) {
      if (this.isDangerousPath(declaredName)) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: `Dangerous filename declared in bundle index: "${declaredName}"`,
          errors: [`Path traversal in declared file entry: ${declaredName}`],
          details: { filesChecked: 0 },
        };
      }
    }

    // 5. Canonical index hash computation (binding without circular self-reference)
    const indexPayload: Record<string, any> = { ...bundleIndex };
    delete indexPayload.bundleDigestSha256;
    delete indexPayload.signatureHex;

    const computedBundleDigest = CanonicalJson.digestSha256(indexPayload);
    if (computedBundleDigest !== bundleIndex.bundleDigestSha256) {
      return {
        isAccepted: false,
        verdict: 'REJECT_MODIFIED_INDEX',
        reason: `Bundle index digest mismatch: bundle-index.json was modified post-signature (Recorded: ${bundleIndex.bundleDigestSha256}, Computed: ${computedBundleDigest})`,
        errors: ['bundle-index.json content does not match its recorded bundleDigestSha256'],
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: 0,
          oracleKeyId: bundleIndex.oracleKeyId,
        },
      };
    }

    // 6. Trust Root verification
    const enforceTrust = options?.enforceTrustStore !== false;
    let signingPublicKeyPem = options?.trustedRootKeyPem;

    if (!signingPublicKeyPem) {
      // Look up public key from Trust Store
      const keyPair = IsolatedKeystore.getOrCreateSigningKeyPair();
      signingPublicKeyPem = keyPair.publicKeyPem;
    }

    const keyFingerprint = IsolatedKeystore.computeFingerprint(signingPublicKeyPem);

    // Explicit Pinned Fingerprint Check
    if (options?.pinnedFingerprint) {
      const expectedPin = options.pinnedFingerprint.toLowerCase().trim();
      if (keyFingerprint.toLowerCase().trim() !== expectedPin) {
        return {
          isAccepted: false,
          verdict: 'REJECT_UNTRUSTED_KEY',
          reason: `Public key fingerprint (${keyFingerprint}) does not match pinned trust fingerprint (${expectedPin}). Key-substitution rejected.`,
          errors: [`Fingerprint pin mismatch: expected ${expectedPin}, got ${keyFingerprint}`],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: 0,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      }
    }

    if (enforceTrust) {
      const isTrusted = IsolatedKeystore.isTrustedPublicKey(signingPublicKeyPem);
      if (!isTrusted) {
        return {
          isAccepted: false,
          verdict: 'REJECT_UNTRUSTED_KEY',
          reason: `Public key (fingerprint: ${keyFingerprint}) is not authorized in Trust Root. Untrusted or substituted key detected.`,
          errors: [`Unauthorized signing key: ${keyFingerprint}`],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: 0,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      }
    }

    // 7. Verify ECDSA signature over canonical bundle digest
    const isSignatureValid = this.verifySignature(
      bundleIndex.bundleDigestSha256,
      bundleIndex.signatureHex,
      signingPublicKeyPem
    );

    if (!isSignatureValid) {
      return {
        isAccepted: false,
        verdict: 'REJECT_MODIFIED_INDEX',
        reason: 'Digital signature on bundle-index.json is invalid, modified, or forged.',
        errors: ['ECDSA signature verification failed against trusted public key'],
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: 0,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
        },
      };
    }

    // 8. Manifest linkage check
    if (options?.expectedManifestHash && bundleIndex.manifestHashSha256 !== options.expectedManifestHash) {
      return {
        isAccepted: false,
        verdict: 'REJECT_STALE_OR_MISMATCHED_MANIFEST',
        reason: `Bundle index manifest hash mismatch: expected ${options.expectedManifestHash}, found ${bundleIndex.manifestHashSha256}`,
        errors: [`Manifest hash mismatch: expected ${options.expectedManifestHash}, actual ${bundleIndex.manifestHashSha256}`],
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: 0,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
        },
      };
    }

    // 9. Pre-check file count and total declared bundle bytes budget
    const declaredFiles = Object.keys(bundleIndex.files);
    if (declaredFiles.length > maxFileCount) {
      return {
        isAccepted: false,
        verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
        reason: `Declared export file count exceeds budget (${declaredFiles.length} > ${maxFileCount})`,
        errors: [`File count budget exceeded: ${declaredFiles.length}`],
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: 0,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
        },
      };
    }

    let declaredTotalBytes = 0;
    for (const entry of Object.values(bundleIndex.files)) {
      const entrySize = entry.size ?? (entry as any).sizeBytes;
      if (typeof entrySize === 'number') {
        declaredTotalBytes += entrySize;
      }
    }
    if (declaredTotalBytes > maxBundleSize) {
      return {
        isAccepted: false,
        verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
        reason: `Total declared bundle size exceeds budget (${declaredTotalBytes} > ${maxBundleSize} bytes)`,
        errors: [`Total bundle budget exceeded: ${declaredTotalBytes} bytes`],
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: 0,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
        },
      };
    }

    const missingFiles: string[] = [];
    const artifactStore = new VerifiedArtifactStore();
    artifactStore.set('bundle-index.json', readIndex.buffer);

    for (const fileName of declaredFiles) {
      const filePath = path.join(exportsDirPath, fileName);
      const readResult = this.readRegularFileDescriptor(filePath, canonicalExportsDir, maxFileSize);

      if (readResult.isResourceExceeded) {
        return {
          isAccepted: false,
          verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
          reason: readResult.error || `File size exceeds safety budget: ${fileName}`,
          errors: [readResult.error || `File size budget exceeded: ${fileName}`],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: 0,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      }

      if (readResult.isDangerous) {
        return {
          isAccepted: false,
          verdict: 'REJECT_DANGEROUS_PATH',
          reason: readResult.error || `Dangerous file detected: ${fileName}`,
          errors: [readResult.error || `Dangerous file: ${fileName}`],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: 0,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      }

      if (readResult.isMissing) {
        missingFiles.push(fileName);
      } else if (readResult.error) {
        return {
          isAccepted: false,
          verdict: 'REJECT_INVALID_STRUCTURE',
          reason: `Failed to read file ${fileName}: ${readResult.error}`,
          errors: [readResult.error],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: 0,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      } else {
        accumulatedBundleBytes += readResult.buffer.length;
        if (accumulatedBundleBytes > maxBundleSize) {
          return {
            isAccepted: false,
            verdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
            reason: `Total bundle size exceeds safety budget (${accumulatedBundleBytes} > ${maxBundleSize} bytes)`,
            errors: [`Bundle size budget exceeded: ${accumulatedBundleBytes} bytes`],
            details: {
              bundleDigest: computedBundleDigest,
              filesChecked: 0,
              oracleKeyId: bundleIndex.oracleKeyId,
              keyFingerprint,
            },
          };
        }
        artifactStore.set(fileName, readResult.buffer);
      }
    }

    if (missingFiles.length > 0) {
      return {
        isAccepted: false,
        verdict: 'REJECT_MISSING_EXPORT',
        reason: `Declared export files are missing on disk: ${missingFiles.join(', ')}`,
        errors: missingFiles.map((f) => `Missing file: ${f}`),
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: declaredFiles.length - missingFiles.length,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
          missingFiles,
        },
      };
    }

    // 10. Check file digest integrity
    const tamperedFiles: string[] = [];
    for (const [fileName, entry] of Object.entries(bundleIndex.files)) {
      const fileBuf = artifactStore.getBuffer(fileName)!;
      const computedSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');
      if (computedSha256 !== entry.digest.sha256) {
        tamperedFiles.push(fileName);
        errors.push(`File "${fileName}" tampered: expected sha256:${entry.digest.sha256}, actual sha256:${computedSha256}`);
      }
    }

    if (tamperedFiles.length > 0) {
      return {
        isAccepted: false,
        verdict: 'REJECT_MODIFIED_EXPORT',
        reason: `Export files modified post-signature: ${tamperedFiles.join(', ')}`,
        errors,
        details: {
          bundleDigest: computedBundleDigest,
          filesChecked: declaredFiles.length,
          oracleKeyId: bundleIndex.oracleKeyId,
          keyFingerprint,
          tamperedFiles,
        },
      };
    }

    // 11. Check unlisted/extraneous files
    const unlistedFiles: string[] = [];
    if (!options?.allowUnlisted) {
      const declaredSet = new Set(declaredFiles);
      declaredSet.add('bundle-index.json');

      for (const diskFile of diskEntries) {
        if (!declaredSet.has(diskFile)) {
          unlistedFiles.push(diskFile);
        }
      }

      if (unlistedFiles.length > 0) {
        return {
          isAccepted: false,
          verdict: 'REJECT_UNLISTED_EXPORT',
          reason: `Unlisted files detected in exports directory: ${unlistedFiles.join(', ')}`,
          errors: unlistedFiles.map((f) => `Unlisted undeclared export: ${f}`),
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: declaredFiles.length,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
            unlistedFiles,
          },
        };
      }
    }

    // 12. Controlled Downstream Staging (verified-byte handoff)
    let stagedPath: string | undefined;
    if (options?.stageToDir) {
      try {
        fs.mkdirSync(options.stageToDir, { recursive: true });
        for (const name of artifactStore.filenames()) {
          const buf = artifactStore.getBuffer(name)!;
          const dest = path.join(options.stageToDir, name);
          fs.writeFileSync(dest, buf, { mode: 0o600 });
        }
        stagedPath = options.stageToDir;
      } catch (err: any) {
        return {
          isAccepted: false,
          verdict: 'REJECT_INVALID_STRUCTURE',
          reason: `Failed to stage verified artifacts to "${options.stageToDir}": ${err.message}`,
          errors: [err.message],
          details: {
            bundleDigest: computedBundleDigest,
            filesChecked: declaredFiles.length,
            oracleKeyId: bundleIndex.oracleKeyId,
            keyFingerprint,
          },
        };
      }
    }

    // 13. Complete acceptance
    return {
      isAccepted: true,
      verdict: 'ACCEPT',
      reason: 'Export bundle is authentic, complete, untampered, and verified against Trust Root.',
      errors: [],
      details: {
        bundleDigest: computedBundleDigest,
        filesChecked: declaredFiles.length,
        oracleKeyId: bundleIndex.oracleKeyId,
        keyFingerprint,
      },
      verifiedBuffers: artifactStore.toMap(),
      artifactStore,
      stagedPath,
    };
  }

  /**
   * Controlled Staging Re-verification (Invariant A & B):
   * Re-verifies on-disk artifacts inside a staged directory immediately prior
   * to consumer execution.
   *
   * Enforces Invariant A: The expectedIndex MUST be cryptographically verified
   * against the Trust Root before its digests can be trusted for staging validation.
   */
  static verifyStagedDirectory(
    stagedDirPath: string,
    expectedIndex: SignedBundleIndex,
    options?: { trustedRootKeyPem?: string; enforceTrustStore?: boolean }
  ): { isClean: boolean; error?: string; tamperedFiles?: string[] } {
    if (!fs.existsSync(stagedDirPath)) {
      return { isClean: false, error: `Staged directory does not exist: ${stagedDirPath}` };
    }

    if (!expectedIndex || typeof expectedIndex !== 'object' || !expectedIndex.files) {
      return { isClean: false, error: 'Expected index is missing or malformed' };
    }

    // Invariant A: Cryptographically verify expectedIndex authenticity before trusting its digests
    const indexPayload: Record<string, any> = { ...expectedIndex };
    delete indexPayload.bundleDigestSha256;
    delete indexPayload.signatureHex;

    const computedDigest = CanonicalJson.digestSha256(indexPayload);
    if (computedDigest !== expectedIndex.bundleDigestSha256) {
      return {
        isClean: false,
        error: `Invariant A violation: expectedIndex payload digest mismatch (${expectedIndex.bundleDigestSha256} vs ${computedDigest})`,
      };
    }

    let signingPublicKeyPem = options?.trustedRootKeyPem;
    if (!signingPublicKeyPem) {
      const keyPair = IsolatedKeystore.getOrCreateSigningKeyPair();
      signingPublicKeyPem = keyPair.publicKeyPem;
    }

    const enforceTrust = options?.enforceTrustStore !== false;
    if (enforceTrust && !IsolatedKeystore.isTrustedPublicKey(signingPublicKeyPem)) {
      return {
        isClean: false,
        error: 'Invariant A violation: expectedIndex signed with untrusted public key',
      };
    }

    const isSigValid = this.verifySignature(
      expectedIndex.bundleDigestSha256,
      expectedIndex.signatureHex,
      signingPublicKeyPem
    );
    if (!isSigValid) {
      return {
        isClean: false,
        error: 'Invariant A violation: expectedIndex has invalid or forged digital signature',
      };
    }

    const tamperedFiles: string[] = [];
    for (const [fileName, entry] of Object.entries(expectedIndex.files)) {
      const stagedFile = path.join(stagedDirPath, fileName);
      if (!fs.existsSync(stagedFile)) {
        return { isClean: false, error: `Staged artifact missing: ${fileName}` };
      }
      const stat = fs.statSync(stagedFile);
      if (!stat.isFile()) {
        return { isClean: false, error: `Staged artifact is not a regular file: ${fileName}` };
      }
      const fileContent = fs.readFileSync(stagedFile);
      const sha256 = crypto.createHash('sha256').update(fileContent).digest('hex');
      if (sha256 !== entry.digest.sha256) {
        tamperedFiles.push(fileName);
      }
    }

    if (tamperedFiles.length > 0) {
      return {
        isClean: false,
        error: `Staged artifacts modified on disk before consumption: ${tamperedFiles.join(', ')}`,
        tamperedFiles,
      };
    }

    return { isClean: true };
  }
}
