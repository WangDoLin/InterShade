import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { StandaloneVerifier, type StandaloneVerifierVerdict } from '../engine/verification/StandaloneVerifier.js';
import { IsolatedKeystore, TrustLevel } from '../engine/verification/IsolatedKeystore.js';

console.log('[TEST]: Starting InterShader V4.1 StandaloneVerifier Hardening Suite with Unified TestRegistry...');

const cwd = process.cwd();
IsolatedKeystore.setTrustLevel(TrustLevel.LEVEL_1_LOCAL);
const testChallenge = crypto.randomBytes(16).toString('hex');

// Step 1: Generate authentic baseline proof and export bundle
const proofReport = await ProofEngine.verify(['cli/index.ts'], {
  cwd,
  challenge: testChallenge,
  skipBuild: true,
  skipTests: true,
  skipTypecheck: true,
  maxFilesBudget: 5,
});

assert.strictEqual(proofReport.overallPassed, true);
const proofDir = path.join(cwd, '.intershader', 'proof', proofReport.runId);
const exportsDir = path.join(proofDir, 'exports');
const manifest = JSON.parse(fs.readFileSync(path.join(proofDir, 'manifest.json'), 'utf-8'));
const keyInfo = IsolatedKeystore.getOrCreateSigningKeyPair();

const tempBase = path.join(cwd, '.intershader', 'proof', `test-registry-sandbox-${Date.now()}`);
fs.mkdirSync(tempBase, { recursive: true });

export interface TestContext {
  exportsDir: string;
  manifest: any;
  keyInfo: any;
  tempBase: string;
}

export interface TestCaseDefinition {
  id: number;
  code: string;
  name: string;
  expectedVerdict: StandaloneVerifierVerdict;
  run: (ctx: TestContext) => Promise<{ actualVerdict: StandaloneVerifierVerdict; isAccepted: boolean; reason: string }>;
}

export class TestRegistry {
  private cases: TestCaseDefinition[] = [];

  register(tc: TestCaseDefinition) {
    this.cases.push(tc);
  }

  async runAll(ctx: TestContext): Promise<void> {
    let matchedCount = 0;
    let failedCount = 0;

    for (const tc of this.cases) {
      console.log(`--- [${tc.id}/${this.cases.length}] ${tc.code}: ${tc.name} ---`);
      try {
        const res = await tc.run(ctx);
        const matches = res.actualVerdict === tc.expectedVerdict;
        if (matches) {
          matchedCount++;
          console.log(`[PASS]: Expected [${tc.expectedVerdict}] == Actual [${res.actualVerdict}]`);
        } else {
          failedCount++;
          console.error(`[FAIL]: Expected [${tc.expectedVerdict}], got [${res.actualVerdict}]. Reason: ${res.reason}`);
        }
      } catch (err: any) {
        failedCount++;
        console.error(`[ERROR]: Unexpected exception in test ${tc.code}: ${err.message}`);
      }
    }

    console.log('\n========================================');
    console.log(`Test cases defined:       ${this.cases.length}`);
    console.log(`Test cases executed:      ${this.cases.length}`);
    console.log(`Expected verdict matched: ${matchedCount}`);
    console.log(`Unexpected result:        ${failedCount}`);
    console.log(`Result: ${failedCount === 0 ? 'PASS' : 'FAIL'}`);
    console.log('========================================\n');

    assert.strictEqual(failedCount, 0, 'All registered test cases must match their expected verdict');
    assert.strictEqual(matchedCount, this.cases.length, 'Matched count must equal total defined cases');
  }
}

const registry = new TestRegistry();

// ----------------------------------------------------
// 1. Authentic Bundle + Trusted Key + Staging Mode
// ----------------------------------------------------
registry.register({
  id: 1,
  code: 'AUTHENTIC_BUNDLE',
  name: 'Authentic bundle with trusted key and pinned fingerprint',
  expectedVerdict: 'ACCEPT',
  run: async (ctx) => {
    const stageDir = path.join(ctx.tempBase, 'staged-verified-artifacts');
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      pinnedFingerprint: ctx.keyInfo.fingerprintSha256,
      stageToDir: stageDir,
    });

    assert.ok(res.verifiedBuffers !== undefined, 'Verified buffers must be populated in memory');
    assert.ok(res.verifiedBuffers.size >= 4, 'Must contain all verified export artifacts in memory');
    assert.ok(fs.existsSync(stageDir), 'Staging directory must be created');
    assert.strictEqual(res.stagedPath, stageDir);

    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 2. Modified Export Byte
// ----------------------------------------------------
registry.register({
  id: 2,
  code: 'MODIFIED_EXPORT',
  name: 'Single byte modification in export artifact',
  expectedVerdict: 'REJECT_MODIFIED_EXPORT',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-2');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    const slsaPath = path.join(dir, 'slsa-provenance-v1.2.json');
    const content = fs.readFileSync(slsaPath, 'utf-8');
    fs.writeFileSync(slsaPath, content.replace('build-artifact', 'tampered-artifact'), 'utf-8');

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 3. Modified Index Payload
// ----------------------------------------------------
registry.register({
  id: 3,
  code: 'MODIFIED_INDEX_PAYLOAD',
  name: 'Tampered field inside bundle-index.json payload',
  expectedVerdict: 'REJECT_MODIFIED_INDEX',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-3');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    const indexPath = path.join(dir, 'bundle-index.json');
    const indexObj = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    indexObj.oracleKeyId = 'oracle-key-attacker-forged';
    fs.writeFileSync(indexPath, JSON.stringify(indexObj, null, 2), 'utf-8');

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 4. Modified Signature Hex
// ----------------------------------------------------
registry.register({
  id: 4,
  code: 'MODIFIED_SIGNATURE',
  name: 'Digital signature corruption / modification',
  expectedVerdict: 'REJECT_MODIFIED_INDEX',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-4');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    const indexPath = path.join(dir, 'bundle-index.json');
    const indexObj = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const origSig = indexObj.signatureHex;
    indexObj.signatureHex = origSig.slice(0, -2) + (origSig.endsWith('00') ? 'ff' : '00');
    fs.writeFileSync(indexPath, JSON.stringify(indexObj, null, 2), 'utf-8');

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 5. Untrusted Signing Key (Rogue Key + Valid Signature)
// ----------------------------------------------------
registry.register({
  id: 5,
  code: 'UNTRUSTED_KEY',
  name: 'Rogue key substitution with valid signature',
  expectedVerdict: 'REJECT_UNTRUSTED_KEY',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-5');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    const rogueKeyPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      trustedRootKeyPem: rogueKeyPair.publicKey,
      enforceTrustStore: true,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 6. Missing Declared File
// ----------------------------------------------------
registry.register({
  id: 6,
  code: 'MISSING_EXPORT',
  name: 'Declared export artifact deleted from filesystem',
  expectedVerdict: 'REJECT_MISSING_EXPORT',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-6');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    fs.rmSync(path.join(dir, 'intoto-statement.json'));

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 7. Unlisted Undeclared Export File
// ----------------------------------------------------
registry.register({
  id: 7,
  code: 'UNLISTED_EXPORT',
  name: 'Extraneous undeclared file injected into exports/',
  expectedVerdict: 'REJECT_UNLISTED_EXPORT',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-7');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'untracked-injection.bin'), 'payload', 'utf-8');

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 8. Symlink / Junction / Reparse Point / Boundary Escape
// ----------------------------------------------------
registry.register({
  id: 8,
  code: 'SYMLINK_REPARSE_ESCAPE',
  name: 'Symbolic link, junction, reparse point, or boundary escape',
  expectedVerdict: 'REJECT_DANGEROUS_PATH',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-8');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });

    const outsideFile = path.join(ctx.tempBase, 'outside-secret.txt');
    fs.writeFileSync(outsideFile, 'secret-data', 'utf-8');

    const symlinkTarget = path.join(dir, 'symlinked-export.json');
    try {
      fs.symlinkSync(outsideFile, symlinkTarget, 'file');
    } catch {
      try {
        const outsideDir = path.join(ctx.tempBase, 'outside-dir');
        fs.mkdirSync(outsideDir, { recursive: true });
        fs.symlinkSync(outsideDir, path.join(dir, 'junction-export'), 'junction');
      } catch {
        // Fallback: non-regular folder inside exports/
        fs.mkdirSync(path.join(dir, 'subfolder'), { recursive: true });
      }
    }

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 9. Stale or Mismatched Manifest Hash
// ----------------------------------------------------
registry.register({
  id: 9,
  code: 'MISMATCHED_MANIFEST',
  name: 'Mismatched manifest hash linkage',
  expectedVerdict: 'REJECT_STALE_OR_MISMATCHED_MANIFEST',
  run: async (ctx) => {
    const mismatchedHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: mismatchedHash,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 10. Short Read or Truncated File Descriptor Loop
// ----------------------------------------------------
registry.register({
  id: 10,
  code: 'SHORT_READ_OR_TRUNCATION',
  name: 'Premature EOF or short read during descriptor reading',
  expectedVerdict: 'REJECT_DANGEROUS_PATH',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-10');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });

    const origReadSync = fs.readSync;
    try {
      let callCount = 0;
      (fs as any).readSync = (...args: any[]) => {
        callCount++;
        // On 2nd read call, return 0 bytes prematurely to simulate sudden EOF before expectedSize
        if (callCount === 2) {
          return 0;
        }
        return (origReadSync as any).apply(fs, args);
      };

      const res = StandaloneVerifier.verifyExportBundle(dir, {
        expectedManifestHash: ctx.manifest.manifestHashSha256,
      });
      return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
    } finally {
      fs.readSync = origReadSync;
    }
  },
});

// ----------------------------------------------------
// 11. File Size Exceeds Safety Budget (DoS Protection)
// ----------------------------------------------------
registry.register({
  id: 11,
  code: 'FILE_SIZE_EXCEEDS_BUDGET',
  name: 'File size exceeds maximum permitted budget limit',
  expectedVerdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
  run: async (ctx) => {
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      maxFileSizeBudget: 16, // Abnormally small budget (e.g. 16 bytes)
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 12. Downstream Buffer Immutability & Defensive Handoff
// ----------------------------------------------------
registry.register({
  id: 12,
  code: 'DOWNSTREAM_BUFFER_TAMPER_RESISTANCE',
  name: 'Mutating retrieved buffer does not alter internal verified store',
  expectedVerdict: 'ACCEPT',
  run: async (ctx) => {
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      pinnedFingerprint: ctx.keyInfo.fingerprintSha256,
    });

    if (!res.isAccepted || !res.artifactStore) {
      return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
    }

    // Downstream caller retrieves and mutates buffer
    const stolenBuf = res.artifactStore.getBuffer('bundle-index.json');
    if (!stolenBuf) {
      return { actualVerdict: 'REJECT_INVALID_STRUCTURE', isAccepted: false, reason: 'Missing buffer' };
    }
    const originalFirstByte = stolenBuf[0];
    stolenBuf[0] = originalFirstByte === 0x7b ? 0x20 : 0x7b; // tamper byte

    // Also mutate via Map view
    const mapBuf = res.verifiedBuffers?.get('bundle-index.json');
    if (mapBuf) {
      mapBuf[0] = 0x00;
    }

    // Verify fresh retrieval from internal store is NOT tampered
    const freshBuf = res.artifactStore.getBuffer('bundle-index.json')!;
    const isUntampered = freshBuf[0] === originalFirstByte;
    assert.strictEqual(isUntampered, true, 'Internal store buffer must be strictly immutable against downstream caller mutations');

    return { actualVerdict: res.verdict, isAccepted: res.isAccepted && isUntampered, reason: res.reason };
  },
});

// ----------------------------------------------------
// 13. Adversarial Windows Reparse Point / Path Divergence Race
// ----------------------------------------------------
registry.register({
  id: 13,
  code: 'ADVERSARIAL_WINDOWS_REPARSE_RACE',
  name: 'Path/reparse point divergence between pre-open and post-open',
  expectedVerdict: 'REJECT_DANGEROUS_PATH',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-13');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });

    const origRealpathNative = (fs.realpathSync as any).native;
    try {
      let indexResolutionCount = 0;
      (fs.realpathSync as any).native = (p: string) => {
        const canonical = origRealpathNative ? origRealpathNative(p) : fs.realpathSync(p);
        if (p.includes('bundle-index.json')) {
          indexResolutionCount++;
          // Resolution 1: Directory scan check
          // Resolution 2: readRegularFileDescriptor pre-open
          // Resolution 3+: readRegularFileDescriptor post-open check (simulate junction/reparse swap during open)
          if (indexResolutionCount >= 3) {
            return `${canonical}_diverged_junction`;
          }
        }
        return canonical;
      };

      const res = StandaloneVerifier.verifyExportBundle(dir, {
        expectedManifestHash: ctx.manifest.manifestHashSha256,
      });
      return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
    } finally {
      (fs.realpathSync as any).native = origRealpathNative;
    }
  },
});

// ----------------------------------------------------
// 14. Staged Artifact Tamper Detection Prior to Consumer
// ----------------------------------------------------
registry.register({
  id: 14,
  code: 'STAGED_ARTIFACT_TAMPER_DETECTION',
  name: 'Pre-consumption verification catches disk modification in staging dir',
  expectedVerdict: 'REJECT_MODIFIED_EXPORT',
  run: async (ctx) => {
    const stageDir = path.join(ctx.tempBase, 'case-14-staging');
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      pinnedFingerprint: ctx.keyInfo.fingerprintSha256,
      stageToDir: stageDir,
    });

    if (!res.isAccepted) {
      return { actualVerdict: res.verdict, isAccepted: false, reason: res.reason };
    }

    const bundleIndex = JSON.parse(fs.readFileSync(path.join(ctx.exportsDir, 'bundle-index.json'), 'utf-8'));

    // Step 1: Initial staged verification passes
    const cleanCheck = StandaloneVerifier.verifyStagedDirectory(stageDir, bundleIndex);
    assert.strictEqual(cleanCheck.isClean, true, 'Clean staged directory must verify cleanly');

    // Step 2: Attacker modifies artifact in stageDir before consumer reads it
    const targetFile = Object.keys(bundleIndex.files)[0];
    const stagedTarget = path.join(stageDir, targetFile);
    fs.appendFileSync(stagedTarget, '\n// tampered by attacker before consumption');

    // Step 3: verifyStagedDirectory catches the modification
    const tamperedCheck = StandaloneVerifier.verifyStagedDirectory(stageDir, bundleIndex);
    assert.strictEqual(tamperedCheck.isClean, false, 'Tampered staged artifact must be detected');
    assert.ok(tamperedCheck.tamperedFiles?.includes(targetFile));

    const simulatedVerdict: StandaloneVerifierVerdict = tamperedCheck.isClean
      ? 'ACCEPT'
      : 'REJECT_MODIFIED_EXPORT';

    return {
      actualVerdict: simulatedVerdict,
      isAccepted: tamperedCheck.isClean,
      reason: tamperedCheck.error || 'Staged files clean',
    };
  },
});

// ----------------------------------------------------
// 15. Resource Limit: File Count Budget Exceeded
// ----------------------------------------------------
registry.register({
  id: 15,
  code: 'RESOURCE_LIMIT_FILE_COUNT',
  name: 'Declared export file count exceeds maximum count budget',
  expectedVerdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
  run: async (ctx) => {
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      maxFileCount: 1, // Budget allows at most 1 file, bundle has multiple
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 16. Resource Limit: Bundle Index Size Exceeded
// ----------------------------------------------------
registry.register({
  id: 16,
  code: 'RESOURCE_LIMIT_INDEX_SIZE',
  name: 'bundle-index.json exceeds maximum index size budget',
  expectedVerdict: 'REJECT_RESOURCE_LIMIT_EXCEEDED',
  run: async (ctx) => {
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      maxIndexSizeBudget: 10, // Budget 10 bytes, bundle-index.json is larger
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

// ----------------------------------------------------
// 17. Invariant A: Untrusted Index Rejected in Staging
// ----------------------------------------------------
registry.register({
  id: 17,
  code: 'UNTRUSTED_INDEX_STAGING_REJECTION',
  name: 'Forged or unsigned expectedIndex rejected during staged verification',
  expectedVerdict: 'REJECT_UNTRUSTED_KEY',
  run: async (ctx) => {
    const stageDir = path.join(ctx.tempBase, 'case-17-staging');
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      pinnedFingerprint: ctx.keyInfo.fingerprintSha256,
      stageToDir: stageDir,
    });
    if (!res.isAccepted) {
      return { actualVerdict: res.verdict, isAccepted: false, reason: res.reason };
    }

    const bundleIndex = JSON.parse(fs.readFileSync(path.join(ctx.exportsDir, 'bundle-index.json'), 'utf-8'));
    // Attacker crafts a forged index with fake signature
    const forgedIndex = {
      ...bundleIndex,
      oracleKeyId: 'attacker-forged-key',
      signatureHex: 'deadbeef'.repeat(16),
    };

    const forgedCheck = StandaloneVerifier.verifyStagedDirectory(stageDir, forgedIndex);
    assert.strictEqual(forgedCheck.isClean, false, 'Forged expectedIndex must be rejected by Invariant A');
    assert.ok(forgedCheck.error?.includes('Invariant A violation'), 'Must report Invariant A violation');

    return {
      actualVerdict: 'REJECT_UNTRUSTED_KEY',
      isAccepted: false,
      reason: forgedCheck.error || 'Invariant A violation',
    };
  },
});

// ----------------------------------------------------
// 18. Invariant B: Verified-Byte In-Memory Handoff
// ----------------------------------------------------
registry.register({
  id: 18,
  code: 'VERIFIED_BYTE_HANDOFF_CONSUMPTION',
  name: 'Consumer executes directly on verified in-memory bytes without disk gap',
  expectedVerdict: 'ACCEPT',
  run: async (ctx) => {
    const res = StandaloneVerifier.verifyExportBundle(ctx.exportsDir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
      pinnedFingerprint: ctx.keyInfo.fingerprintSha256,
    });

    if (!res.isAccepted || !res.artifactStore) {
      return { actualVerdict: res.verdict, isAccepted: false, reason: res.reason };
    }

    // Consumer consumes verified bytes directly from memory
    let consumedBytesLength = 0;
    const consumedResult = res.artifactStore.consumeBuffer('bundle-index.json', (buf) => {
      consumedBytesLength = buf.length;
      return JSON.parse(buf.toString('utf-8'));
    });

    assert.ok(consumedResult.oracleKeyId, 'Consumer must receive authentic parsed artifact');
    assert.ok(consumedBytesLength > 0, 'Consumer must receive non-empty buffer');

    return {
      actualVerdict: res.verdict,
      isAccepted: res.isAccepted,
      reason: 'Verified in-memory byte handoff executed successfully',
    };
  },
});

// ----------------------------------------------------
// 19. Real Windows NTFS Junction / Boundary Escape Inspection
// ----------------------------------------------------
registry.register({
  id: 19,
  code: 'REAL_WINDOWS_NTFS_JUNCTION_INSPECTION',
  name: 'Real NTFS junction pointing outside exports directory is rejected',
  expectedVerdict: 'REJECT_DANGEROUS_PATH',
  run: async (ctx) => {
    const dir = path.join(ctx.tempBase, 'case-19');
    fs.cpSync(ctx.exportsDir, dir, { recursive: true });

    const outsideTarget = path.join(ctx.tempBase, 'outside-target-dir');
    fs.mkdirSync(outsideTarget, { recursive: true });
    fs.writeFileSync(path.join(outsideTarget, 'leak.txt'), 'confidential-data', 'utf-8');

    const junctionPath = path.join(dir, 'junction-escape-link');
    try {
      fs.symlinkSync(outsideTarget, junctionPath, 'junction');
    } catch {
      try {
        fs.symlinkSync(outsideTarget, junctionPath, 'dir');
      } catch {
        // Fallback if OS privileges restrict symlinks
        fs.mkdirSync(junctionPath, { recursive: true });
      }
    }

    const res = StandaloneVerifier.verifyExportBundle(dir, {
      expectedManifestHash: ctx.manifest.manifestHashSha256,
    });
    return { actualVerdict: res.verdict, isAccepted: res.isAccepted, reason: res.reason };
  },
});

try {
  await registry.runAll({
    exportsDir,
    manifest,
    keyInfo,
    tempBase,
  });
} finally {
  fs.rmSync(tempBase, { recursive: true, force: true });
}


