import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CanonicalJson } from '../engine/verification/CanonicalJson.js';
import { IsolatedKeystore, TrustLevel } from '../engine/verification/IsolatedKeystore.js';
import { AttestationAuthority, ChallengeRegistry } from '../engine/verification/AttestationAuthority.js';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { BenchmarkMetricsEngine, type RawTaskObservation } from '../engine/benchmark/BenchmarkMetricsEngine.js';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';
import { SchemaValidator } from '../engine/verification/SchemaValidator.js';

console.log('[TEST]: Starting InterShader V4 Trusted Proof Infrastructure Test Suite...');

const cwd = process.cwd();

// ========================================================
// 1. Canonical JSON Serialization (RFC 8785 / JCS True Compliance)
// ========================================================
console.log('--- 1. Testing Canonical JSON Serialization (RFC 8785 JCS) ---');

const objA = {
  zebra: 100,
  apple: 'red',
  nested: { bravo: true, alpha: [3, 2, 1] },
  unicode: 'Tiếng Việt 🚀',
  zeroVal: -0,
};

const objB = {
  zeroVal: 0,
  apple: 'red',
  unicode: 'Tiếng Việt 🚀',
  nested: { alpha: [3, 2, 1], bravo: true },
  zebra: 100,
};

const strA = CanonicalJson.stringify(objA);
const strB = CanonicalJson.stringify(objB);
assert.strictEqual(strA, strB, 'Canonical JSON must produce identical strings regardless of key order');

const hashA = CanonicalJson.digestSha256(objA);
const hashB = CanonicalJson.digestSha256(objB);
assert.strictEqual(hashA, hashB, 'Canonical digests must be bit-exact identical');
console.log(`[PASS]: CanonicalJson verified: deterministic digest = ${hashA.slice(0, 16)}...`);

// ========================================================
// 2. 3-Tier Trust Model & Isolated Keystore
// ========================================================
console.log('--- 2. Testing 3-Tier Trust Model (Local, OS, Remote KMS) ---');

const keyInfo = IsolatedKeystore.getOrCreateSigningKeyPair();
assert.ok(keyInfo.oracleKeyId.startsWith('oracle-key-'));
assert.strictEqual(keyInfo.fingerprintSha256.length, 64);
assert.ok(keyInfo.publicKeyPem.includes('BEGIN PUBLIC KEY'));
assert.ok(keyInfo.privateKeyPem.includes('BEGIN PRIVATE KEY'));

// Level 1: Local Trust
IsolatedKeystore.setTrustLevel(TrustLevel.LEVEL_1_LOCAL);
assert.strictEqual(IsolatedKeystore.getTrustLevel(), TrustLevel.LEVEL_1_LOCAL);

// Check trust store contains root key
const isRootTrusted = IsolatedKeystore.isTrustedPublicKey(keyInfo.publicKeyPem);
assert.strictEqual(isRootTrusted, true, 'Oracle root key must be recognized in Trust Store');

// Level 2 / Level 3 transitions
IsolatedKeystore.setTrustLevel(TrustLevel.LEVEL_2_OS_BACKED);
assert.strictEqual(IsolatedKeystore.getTrustLevel(), TrustLevel.LEVEL_2_OS_BACKED);

IsolatedKeystore.configureRemoteSigner({
  serviceEndpoint: 'https://kms.us-east-1.amazonaws.com/intershader-signer',
  keyArnOrId: 'arn:aws:kms:us-east-1:123456789012:key/test-oracle-key',
});
assert.strictEqual(IsolatedKeystore.getTrustLevel(), TrustLevel.LEVEL_3_REMOTE_KMS);

// Reset back to Level 1 for local test flow
IsolatedKeystore.setTrustLevel(TrustLevel.LEVEL_1_LOCAL);
console.log(`[PASS]: 3-Tier Trust Architecture verified (Current: ${IsolatedKeystore.getTrustLevel()}).`);

// ========================================================
// 3. Enriched Manifest & Supply Chain Exports (SLSA v1.2, in-toto Bundle)
// ========================================================
console.log('--- 3. Testing Enriched Proof Manifest, SLSA v1.2 & Export Bundle ---');

const testChallenge = crypto.randomBytes(16).toString('hex');

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

// Check standard root protocol files exist on disk
assert.ok(fs.existsSync(path.join(proofDir, 'manifest.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'attestation.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'intoto.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'slsa-provenance.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'verdict.json')));

// Check exports bundle files exist on disk
assert.ok(fs.existsSync(path.join(exportsDir, 'intershader-proof.json')));
assert.ok(fs.existsSync(path.join(exportsDir, 'intoto-statement.json')));
assert.ok(fs.existsSync(path.join(exportsDir, 'in-toto-test-result.json')));
assert.ok(fs.existsSync(path.join(exportsDir, 'slsa-provenance-v1.2.json')));
assert.ok(fs.existsSync(path.join(exportsDir, 'slsa-provenance-v1.0.json')));

// Validate manifest provenance and fingerprint fields
const manifest = JSON.parse(fs.readFileSync(path.join(proofDir, 'manifest.json'), 'utf-8'));
assert.strictEqual(manifest.protocolVersion, '1.0');
assert.strictEqual(manifest.policyVersion, '1.0');
assert.ok(manifest.policyDigest !== undefined && manifest.policyDigest.startsWith('sha256:'));
assert.ok(manifest.oracleKeyId.startsWith('oracle-key-'));
assert.strictEqual(manifest.challenge, testChallenge);
assert.strictEqual(manifest.evaluatorVersion, '2.5.0-attested');
assert.strictEqual(manifest.hiddenTestVersion, '2026.10-v1');
assert.ok(manifest.nonce !== undefined && manifest.nonce.length > 10);
assert.ok(manifest.expiresAt !== undefined);
assert.ok(manifest.issuedAt !== undefined);
assert.ok(manifest.environmentFingerprint.platform !== undefined);
assert.ok(manifest.dependencyFingerprint.startsWith('sha256:'));
assert.ok(manifest.workspaceCommit === null || /^[0-9a-f]{40}$/i.test(manifest.workspaceCommit));
assert.notStrictEqual(manifest.workspaceCommit, 'non-git-workspace-snapshot', 'No fake strings permitted for Git commit');
assert.ok(manifest.verifiedSourceDigest !== undefined && manifest.verifiedSourceDigest.startsWith('sha256:'));
const expectedDistHash = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(path.join(cwd, 'dist/index.js'))).digest('hex');
assert.strictEqual(manifest.buildArtifactDigest, expectedDistHash);
assert.strictEqual(manifest.artifactDigest, manifest.buildArtifactDigest);
assert.notStrictEqual(
  manifest.verifiedSourceDigest,
  manifest.buildArtifactDigest,
  'Verified source digest and build artifact digest must be separated'
);
assert.ok(manifest.subject !== undefined && manifest.subject.artifactDigest.startsWith('sha256:'));

// Validate SLSA v1.2 Provenance statement binds build artifact with standard digest map
const slsa12 = JSON.parse(fs.readFileSync(path.join(exportsDir, 'slsa-provenance-v1.2.json'), 'utf-8'));
assert.strictEqual(slsa12._type, 'https://in-toto.io/Statement/v1');
assert.strictEqual(slsa12.predicateType, 'https://slsa.dev/provenance/v1');
assert.strictEqual(slsa12.subject[0].name, 'build-artifact');
assert.ok(slsa12.subject[0].digest.sha256 !== undefined);
assert.strictEqual(slsa12.subject[0].digest.sha256, manifest.buildArtifactDigest.replace('sha256:', ''));
assert.strictEqual(slsa12.predicate.buildDefinition.buildType, 'https://intershader.dev/verification-oracle/v4.2');
// Verification telemetry must NOT leak into SLSA internalParameters
assert.strictEqual(slsa12.predicate.buildDefinition.internalParameters.challenge, undefined);
assert.strictEqual(slsa12.predicate.buildDefinition.internalParameters.overallPassed, undefined);
assert.strictEqual(slsa12.predicate.buildDefinition.internalParameters.riskScore, undefined);
assert.strictEqual(slsa12.predicate.buildDefinition.internalParameters.totalGatesEvaluated, undefined);
assert.ok(slsa12.predicate.buildDefinition.internalParameters.evaluatorVersion !== undefined);
assert.ok(slsa12.predicate.buildDefinition.resolvedDependencies.length >= 1);
assert.strictEqual(
  slsa12.predicate.buildDefinition.resolvedDependencies[0].digest.sha256,
  manifest.verifiedSourceDigest.replace('sha256:', ''),
  'SLSA resolvedDependencies must cryptographically link to verifiedSourceDigest via digest.sha256'
);
assert.strictEqual(
  slsa12.predicate.runDetails.builder.id,
  'https://intershader.dev/attestation-authority/v4.2/local-node-engine'
);

// Validate in-toto Link statement (link/v0.3): subject = build product, materials = verified source
const intotoStatement = JSON.parse(fs.readFileSync(path.join(exportsDir, 'intoto-statement.json'), 'utf-8'));
assert.strictEqual(intotoStatement._type, 'https://in-toto.io/Statement/v1');
assert.strictEqual(intotoStatement.predicateType, 'https://in-toto.io/attestation/link/v0.3');
assert.strictEqual(intotoStatement.subject[0].name, 'build-artifact');
assert.ok(intotoStatement.subject[0].digest.sha256 !== undefined);
assert.strictEqual(intotoStatement.subject[0].digest.sha256, manifest.buildArtifactDigest.replace('sha256:', ''));
assert.strictEqual(intotoStatement.predicate.materials[0].name, 'verified-source-snapshot');
assert.strictEqual(
  intotoStatement.predicate.materials[0].digest.sha256,
  manifest.verifiedSourceDigest.replace('sha256:', ''),
  'in-toto link statement materials must bind sourceSnapshot via digest.sha256'
);
assert.strictEqual(
  intotoStatement.predicate.products,
  undefined,
  'in-toto link/v0.3 uses Statement subject as products and omits predicate.products'
);
assert.ok(intotoStatement.predicate.byproducts !== undefined, 'in-toto Link v0.3 must contain lowercase byproducts');
assert.strictEqual(intotoStatement.predicate.byProducts, undefined, 'in-toto Link v0.3 must NOT contain camelCase byProducts');
assert.strictEqual(intotoStatement.predicate.byproducts.overallPassed, true);

// Validate in-toto Test Result statement (test-result/v0.1) binds verified source and test configuration
const testResult = JSON.parse(fs.readFileSync(path.join(exportsDir, 'in-toto-test-result.json'), 'utf-8'));
assert.strictEqual(testResult._type, 'https://in-toto.io/Statement/v1');
assert.strictEqual(testResult.predicateType, 'https://in-toto.io/attestation/test-result/v0.1');
assert.strictEqual(testResult.predicate.result, 'PASSED');
assert.strictEqual(testResult.subject[0].name, 'verified-source-snapshot');
assert.strictEqual(
  testResult.subject[0].digest.sha256,
  manifest.verifiedSourceDigest.replace('sha256:', ''),
  'in-toto test-result subject must bind sourceSnapshot via digest.sha256'
);
assert.ok(Array.isArray(testResult.predicate.configuration));
assert.ok(testResult.predicate.configuration[0].digest.sha256 !== undefined);
assert.ok(Array.isArray(testResult.predicate.passedTests));
assert.ok(testResult.predicate.passedTests.length > 0);
assert.ok(
  !testResult.predicate.passedTests.some((t: string) => /^G\d+-G\d+/.test(t)),
  'Gate test names in passedTests must not have duplicate Gx-Gx prefix'
);
assert.ok(Array.isArray(testResult.predicate.warnedTests));
assert.ok(Array.isArray(testResult.predicate.failedTests));

// Validate all on-disk JSON exports with independent SchemaValidator
const schemaReport = SchemaValidator.validateBundleOnDisk(exportsDir);
assert.strictEqual(schemaReport.valid, true, `Schema validation failed: ${JSON.stringify(schemaReport.results)}`);

// Validate SignedBundleIndex exists and cryptographically binds all exported artifacts
const bundleIndex = JSON.parse(fs.readFileSync(path.join(exportsDir, 'bundle-index.json'), 'utf-8'));
assert.strictEqual(bundleIndex._type, 'https://intershader.dev/bundle-index/v1');
assert.strictEqual(bundleIndex.manifestHashSha256, manifest.manifestHashSha256);
assert.ok(bundleIndex.bundleDigestSha256 !== undefined);
assert.ok(bundleIndex.signatureHex !== undefined);
assert.ok(bundleIndex.files['intoto-statement.json'] !== undefined);
assert.ok(bundleIndex.files['slsa-provenance-v1.2.json'] !== undefined);

// Standalone export bundle verification via AttestationAuthority
const bundleVerifyResult = AttestationAuthority.verifyExportBundle(
  exportsDir,
  manifest.manifestHashSha256
);
assert.strictEqual(bundleVerifyResult.isValid, true);
assert.strictEqual(bundleVerifyResult.verdict, 'BUNDLE_VALID');

// Export Tamper Defense Test: Downstream tampering of export file must be detected
const originalIntotoContent = fs.readFileSync(path.join(exportsDir, 'intoto-statement.json'), 'utf-8');
try {
  fs.writeFileSync(
    path.join(exportsDir, 'intoto-statement.json'),
    originalIntotoContent.replace('"overallPassed": true', '"overallPassed": false'),
    'utf-8'
  );
  const tamperedReport = AttestationAuthority.verifyProofDirectory(proofDir, {
    expectedChallenge: testChallenge,
  });
  assert.strictEqual(tamperedReport.isValid, false, 'Tampered export file must be caught by verifier');
  assert.strictEqual(tamperedReport.verdict, 'EXPORT_BUNDLE_TAMPERED');
  assert.ok(tamperedReport.errors.some((e: string) => e.includes('tampered') || e.includes('digest mismatch')));
} finally {
  // Restore authentic export file
  fs.writeFileSync(path.join(exportsDir, 'intoto-statement.json'), originalIntotoContent, 'utf-8');
}

console.log('[PASS]: Enriched manifest, separated source vs build digests, cryptographic source-to-build provenance link, schema-conformant SLSA v1.2, in-toto Link v0.3, and Test Result v0.1 statements verified.');

// ========================================================
// 4. Challenge-based Anti-Replay Defense
// ========================================================
console.log('--- 4. Testing Challenge-based Anti-Replay Defense ---');

// Fresh challenge verification passes
const validChallengeReport = AttestationAuthority.verifyProofDirectory(proofDir, {
  expectedChallenge: testChallenge,
});
assert.strictEqual(validChallengeReport.isValid, true);
assert.strictEqual(validChallengeReport.verdict, 'ATTESTED_VALID');

// Wrong challenge verification fails (Replay of stale proof under different challenge)
const wrongChallenge = 'different-verifier-challenge-12345';
const staleReport = AttestationAuthority.verifyProofDirectory(proofDir, {
  expectedChallenge: wrongChallenge,
});
assert.strictEqual(staleReport.isValid, false);
assert.strictEqual(staleReport.verdict, 'CHALLENGE_MISMATCH');
assert.ok(staleReport.errors.some((e) => e.includes('Challenge mismatch')));

// Consumed challenge replay detection
ChallengeRegistry.clear();
const firstConsumeReport = AttestationAuthority.verifyProofDirectory(proofDir, {
  expectedChallenge: testChallenge,
  consumeChallenge: true,
});
assert.strictEqual(firstConsumeReport.isValid, true);

// Re-verifying same consumed challenge must be rejected as replay attack
const replayReport = AttestationAuthority.verifyProofDirectory(proofDir, {
  expectedChallenge: testChallenge,
  consumeChallenge: true,
});
assert.strictEqual(replayReport.isValid, false);
assert.strictEqual(replayReport.verdict, 'REPLAY_ATTACK_DETECTED');
assert.ok(replayReport.errors.some((e) => e.includes('Replay attack detected')));

// Monotonic Checkpoint Rollback Detection Test
const rollbackTestPath = (ChallengeRegistry as any).getStoragePath();
const validRecords = JSON.parse(fs.readFileSync(rollbackTestPath, 'utf-8'));
assert.ok(validRecords.length >= 1);

// Save monotonic checkpoint of current head
ChallengeRegistry.saveCheckpoint('ci-server-anchor');

// Attacker attempts rollback: replaces registry with empty snapshot while checkpoint remains
ChallengeRegistry.resetMemoryCache();
fs.writeFileSync(rollbackTestPath, JSON.stringify([]), 'utf-8');

const rollbackCheck = ChallengeRegistry.verifyRegistryIntegrity();
assert.strictEqual(rollbackCheck.isValid, false);
assert.ok(rollbackCheck.error?.includes('REGISTRY_ROLLBACK_DETECTED'));

// Restore valid records
fs.writeFileSync(rollbackTestPath, JSON.stringify(validRecords, null, 2), 'utf-8');
ChallengeRegistry.resetMemoryCache();
assert.strictEqual(ChallengeRegistry.verifyRegistryIntegrity().isValid, true);

console.log('[PASS]: Challenge-based anti-replay verification & Monotonic Checkpoint rollback defense successfully verified.');

// ========================================================
// 5. Key-Substitution & Trust Store Compromise Defense
// ========================================================
console.log('--- 5. Testing Key-Substitution & Pinning Defense ---');

const attackDir = path.join(cwd, '.intershader', 'proof', `attack-${Date.now()}`);
fs.cpSync(proofDir, attackDir, { recursive: true });

// Attacker generates a rogue keypair
const rogueKeyPair = crypto.generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// Attacker forges manifest score to 100
const attackManifestPath = path.join(attackDir, 'manifest.json');
const forgedManifest = JSON.parse(fs.readFileSync(attackManifestPath, 'utf-8'));
forgedManifest.score = 100;
delete forgedManifest.manifestHashSha256;
delete forgedManifest.attestation;

// Attacker computes new hash and signs with rogue private key
const rogueHash = CanonicalJson.digestSha256(forgedManifest);
forgedManifest.manifestHashSha256 = rogueHash;
fs.writeFileSync(attackManifestPath, JSON.stringify(forgedManifest, null, 2), 'utf-8');

const rogueSign = crypto.createSign('SHA256');
rogueSign.update(Buffer.from(rogueHash, 'hex'));
rogueSign.end();
const rogueSignatureHex = rogueSign.sign(rogueKeyPair.privateKey, 'hex');

// Attacker substitutes public key in attestation.json
const rogueAttestation = {
  oracleId: 'rogue-oracle-substitute',
  oracleKeyId: 'rogue-key-999',
  publicKeyPem: rogueKeyPair.publicKey,
  publicKeyFingerprint: IsolatedKeystore.computeFingerprint(rogueKeyPair.publicKey),
  signatureAlgorithm: 'SHA256withECDSA',
  signatureHex: rogueSignatureHex,
  signedAt: new Date().toISOString(),
  manifestHashSha256: rogueHash,
};
fs.writeFileSync(path.join(attackDir, 'attestation.json'), JSON.stringify(rogueAttestation, null, 2), 'utf-8');

// Verify that InterShader rejects the forged proof because rogue key is not in Trust Root
const attackReport = AttestationAuthority.verifyProofDirectory(attackDir);
assert.strictEqual(attackReport.isValid, false, 'Must reject substituted key');
assert.strictEqual(attackReport.verdict, 'UNTRUSTED_ORACLE_KEY');
assert.ok(attackReport.errors.some((e) => e.includes('Key-substitution')));

// Pinning defense: Pin authentic key fingerprint to guard against trust store alteration
IsolatedKeystore.pinFingerprint(keyInfo.fingerprintSha256);
const pinnedCheck = IsolatedKeystore.isTrustedPublicKey(keyInfo.publicKeyPem);
assert.strictEqual(pinnedCheck, true);
const rogueCheck = IsolatedKeystore.isTrustedPublicKey(rogueKeyPair.publicKey);
assert.strictEqual(rogueCheck, false, 'Rogue key must be rejected by Pinning Defense');

fs.rmSync(attackDir, { recursive: true, force: true });
console.log('[PASS]: Key-substitution attack thwarted & Pinning Defense verified.');

// ========================================================
// 6. Proof Expiration TTL Check
// ========================================================
console.log('--- 6. Testing Proof Expiration TTL ---');

const expiredDir = path.join(cwd, '.intershader', 'proof', `expired-${Date.now()}`);
fs.cpSync(proofDir, expiredDir, { recursive: true });

const expiredManifestPath = path.join(expiredDir, 'manifest.json');
const expiredManifest = JSON.parse(fs.readFileSync(expiredManifestPath, 'utf-8'));
expiredManifest.expiresAt = new Date(Date.now() - 3600000).toISOString();
fs.writeFileSync(expiredManifestPath, JSON.stringify(expiredManifest, null, 2), 'utf-8');

const expiredReport = AttestationAuthority.verifyProofDirectory(expiredDir);
assert.strictEqual(expiredReport.isValid, false, 'Must reject expired proof');
assert.strictEqual(expiredReport.verdict, 'PROOF_EXPIRED');

fs.rmSync(expiredDir, { recursive: true, force: true });
console.log('[PASS]: Proof expiration verified: expired attestations safely rejected.');

// ========================================================
// 7. Evidence Escape Rate as #1 Metric in Benchmark Scorecard
// ========================================================
console.log('--- 7. Testing Evidence Escape Rate as #1 Benchmark Metric ---');

const testObservations: RawTaskObservation[] = [
  {
    taskId: 'TASK-001',
    agentClaimedSuccess: true,
    oracleVerifiedSuccess: true,
    independentEvaluatorSuccess: true, // TRUE POSITIVE
    firstPass: true,
    repaired: false,
    hiddenTestsPassed: true,
    mutantsTotal: 10,
    mutantsKilled: 10,
    counterexamplesProbed: 14,
    counterexamplesReproduced: 0,
    regressionsDetected: 0,
    humanInterventions: 0,
    repairIterations: 0,
    evidenceFilesExpected: 10,
    evidenceFilesActual: 10,
    attestationValid: true,
  },
  {
    taskId: 'TASK-002',
    agentClaimedSuccess: true,
    oracleVerifiedSuccess: true,
    independentEvaluatorSuccess: false, // ESCAPE! False Negative
    firstPass: true,
    repaired: false,
    hiddenTestsPassed: false,
    mutantsTotal: 10,
    mutantsKilled: 6,
    counterexamplesProbed: 14,
    counterexamplesReproduced: 0,
    regressionsDetected: 0,
    humanInterventions: 0,
    repairIterations: 0,
    evidenceFilesExpected: 10,
    evidenceFilesActual: 10,
    attestationValid: true,
  },
];

const metrics = BenchmarkMetricsEngine.computeMetrics(testObservations);
assert.strictEqual(metrics.totalTasks, 2);
assert.strictEqual(metrics.evidenceEscapeRate, 50.0);
assert.strictEqual(metrics.proofForgeryDetectionRate, 100.0);
assert.strictEqual(metrics.mutationKillRate, 80.0);

// Check Evidence Escape Rate is in line 1 of summaryReport
const summaryLines = metrics.summaryReport.split('\n');
const metricLine1 = summaryLines.find((l) => l.includes('1. Evidence Escape Rate'));
assert.ok(metricLine1 && metricLine1.includes('Evidence Escape Rate'), 'Evidence Escape Rate must be metric #1');
console.log(`[PASS]: Benchmark Scorecard has Evidence Escape Rate at #1 position (${metrics.evidenceEscapeRate}%).`);

// ========================================================
// 8. CLI /verify-proof Command with Challenge
// ========================================================
console.log('--- 8. Testing CLI /verify-proof with --challenge Flag ---');

ChallengeRegistry.clear();

const registry = new CommandRegistry();
registerBuiltinCommands(registry);

const verifyCmd = registry.get('verify-proof')!;
assert.strictEqual(verifyCmd.type, 'local');
if (verifyCmd.type === 'local') {
  const output = await verifyCmd.execute({
    cwd,
    sessionState: {},
    args: [proofDir, '--challenge', testChallenge],
  });
  assert.ok(output.includes('CRYPTOGRAPHIC PROOF VERIFICATION'));
  assert.ok(output.includes('AUTHENTIC & UNTAMPERED'));
  assert.ok(output.includes('SLSA v1.2 (Active)'));
  assert.ok(output.includes(testChallenge));
  console.log('[PASS]: /verify-proof validated authentic proof directory with fresh challenge.');
}

console.log('\n[SUCCESS]: ALL 8 V4 TRUSTED PROOF INFRASTRUCTURE TESTS PASSED 100%!');
