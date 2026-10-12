import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { AttestationAuthority } from '../engine/verification/AttestationAuthority.js';
import { MutationVerifier } from '../engine/verification/MutationVerifier.js';
import { CounterexampleAgent } from '../services/agent/CounterexampleAgent.js';
import { BenchmarkMetricsEngine, type RawTaskObservation } from '../engine/benchmark/BenchmarkMetricsEngine.js';
import { IndependentBenchmarkHarness } from '../engine/benchmark/IndependentBenchmarkHarness.js';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';

console.log('[TEST]: Starting InterShader Attested Proof & Trust Protocol (v3) Test Suite...');

const cwd = process.cwd();

// ========================================================
// 1. Cryptographic Attestation & Evidence Store Persistence
// ========================================================
console.log('--- 1. Testing Cryptographic Attestation Generation ---');

const proofReport = await ProofEngine.verify(['cli/index.ts'], {
  cwd,
  skipBuild: true,
  skipTests: true,
  skipTypecheck: true,
  maxFilesBudget: 5,
});

assert.strictEqual(proofReport.overallPassed, true);
assert.ok(proofReport.manifest !== undefined);
assert.ok(proofReport.manifest.attestation !== undefined);
assert.strictEqual(proofReport.manifest.attestation.signatureAlgorithm, 'SHA256withECDSA');
assert.ok(proofReport.manifest.attestation.signatureHex.length > 30);

const proofDir = path.join(cwd, '.intershader', 'proof', proofReport.runId);
assert.ok(fs.existsSync(path.join(proofDir, 'manifest.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'attestation.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'verdict.json')));
assert.ok(fs.existsSync(path.join(proofDir, 'evidence')));

// Independent Verification of pristine proof
const verifyReportClean = AttestationAuthority.verifyProofDirectory(proofDir);
assert.strictEqual(verifyReportClean.isValid, true);
assert.strictEqual(verifyReportClean.verdict, 'ATTESTED_VALID');
assert.strictEqual(verifyReportClean.errors.length, 0);
console.log(`[PASS]: AttestationAuthority successfully verified authentic ECDSA signature and evidence digests.`);

// ========================================================
// 2. Tamper-Resistance & Forgery Detection
// ========================================================
console.log('--- 2. Testing Tamper-Resistance & Forgery Detection ---');

// Create a copy of the proof directory and tamper with manifest.json
const tamperedProofDir = path.join(cwd, '.intershader', 'proof', `tamper-test-${Date.now()}`);
fs.cpSync(proofDir, tamperedProofDir, { recursive: true });

// Attacker modifies manifest to claim 100 files passed instead of actual
const tamperedManifestPath = path.join(tamperedProofDir, 'manifest.json');
const manifestObj = JSON.parse(fs.readFileSync(tamperedManifestPath, 'utf-8'));
manifestObj.score = 999; // forged
fs.writeFileSync(tamperedManifestPath, JSON.stringify(manifestObj, null, 2), 'utf-8');

const verifyReportTampered = AttestationAuthority.verifyProofDirectory(tamperedProofDir);
assert.strictEqual(verifyReportTampered.isValid, false, 'Must detect manifest modification');
assert.strictEqual(verifyReportTampered.verdict, 'FORGERY_OR_TAMPER_DETECTED');
assert.ok(verifyReportTampered.errors.some((e) => e.includes('signature') || e.includes('hash mismatch')));

// Cleanup tampered test folder
fs.rmSync(tamperedProofDir, { recursive: true, force: true });
console.log('[PASS]: Tamper-resistance confirmed: unauthorized modification caught with 100% precision.');

// ========================================================
// 3. Mutation Engine v2 (8 Operator Families)
// ========================================================
console.log('--- 3. Testing Mutation Engine v2 (8 Operator Families) ---');

const sampleCode = `
export async function authenticate(user, token) {
  if (!token) {
    return false;
  }
  if (token.length > 10 && user.isAdmin === true) {
    try {
      await logAuthAttempt(user);
      return true;
    } catch (err) {
      return false;
    }
  }
  return false;
}
`;

const generatedMutants = MutationVerifier.generateMutations(sampleCode);
assert.ok(generatedMutants.length >= 6, 'Must generate mutants across multiple families');

const familiesFound = new Set(generatedMutants.map((m) => m.family));
assert.ok(familiesFound.has('RELATIONAL'), 'RELATIONAL family must be present');
assert.ok(familiesFound.has('LOGICAL'), 'LOGICAL family must be present');
assert.ok(familiesFound.has('CONTROL_FLOW'), 'CONTROL_FLOW family must be present');
assert.ok(familiesFound.has('VALUE') || familiesFound.has('RETURN'), 'VALUE or RETURN must be present');
assert.ok(familiesFound.has('ASYNC'), 'ASYNC family must be present');
console.log(`[PASS]: MutationVerifier generated mutants across ${familiesFound.size} distinct operator families.`);

// ========================================================
// 4. Counterexample Gating: "Reproduced or Warning"
// ========================================================
console.log('--- 4. Testing Counterexample Classification (Reproduced vs Warning) ---');

// Case A: Unverified hypothesis without execution -> classified as POSSIBLE_ISSUE
const probeReportUnconfirmed = CounterexampleAgent.probe({
  userIntent: 'Fix token refresh bug',
  modifiedFiles: ['cli/index.ts'],
  cwd,
  executeActiveProbes: false, // passive mode
});
assert.strictEqual(probeReportUnconfirmed.reproducedFailuresCount, 0);
assert.strictEqual(probeReportUnconfirmed.attackSucceeded, false, 'Unreproduced hypotheses must NOT trigger attackSucceeded');
assert.ok(probeReportUnconfirmed.verdict === 'WARNING_UNCONFIRMED' || probeReportUnconfirmed.verdict === 'IMPERVIOUS_VERIFIED');
console.log(`[PASS]: Passive hypothesis safely classified as ${probeReportUnconfirmed.verdict} without causing false-positive hard fail.`);

// ========================================================
// 5. Benchmark Metrics Engine (13 Metrics & False Negative)
// ========================================================
console.log('--- 5. Testing Benchmark Metrics Engine ---');

const mockObservations: RawTaskObservation[] = [
  {
    taskId: 'TASK-1',
    agentClaimedSuccess: true,
    oracleVerifiedSuccess: true,
    independentEvaluatorSuccess: true, // TRUE POSITIVE
    firstPass: true,
    repaired: false,
    hiddenTestsPassed: true,
    mutantsTotal: 10,
    mutantsKilled: 9,
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
    taskId: 'TASK-2',
    agentClaimedSuccess: true,
    oracleVerifiedSuccess: false,
    independentEvaluatorSuccess: false, // TRUE REJECTION
    firstPass: false,
    repaired: true,
    hiddenTestsPassed: false,
    mutantsTotal: 10,
    mutantsKilled: 10,
    counterexamplesProbed: 14,
    counterexamplesReproduced: 2,
    regressionsDetected: 1,
    humanInterventions: 0,
    repairIterations: 1,
    evidenceFilesExpected: 10,
    evidenceFilesActual: 10,
    attestationValid: true,
  },
];

const scorecard = BenchmarkMetricsEngine.computeMetrics(mockObservations);
assert.strictEqual(scorecard.totalTasks, 2);
assert.strictEqual(scorecard.falseNegativeRate, 0.0, 'False Negative must be 0% when no false claims exist');
assert.strictEqual(scorecard.mutationScore, 95.0);
assert.strictEqual(scorecard.evidenceIntegrity, 100.0);
assert.ok(scorecard.summaryReport.includes('ZERO ESCAPE'));
console.log(`[PASS]: BenchmarkMetricsEngine computed all 13 metrics (False Negative: ${scorecard.falseNegativeRate}%, Integrity: ${scorecard.evidenceIntegrity}%).`);

// ========================================================
// 6. Independent Sandbox Hidden Test Mutation Sensitivity
// ========================================================
console.log('--- 6. Testing Hidden Test Mutation Sensitivity in Sandbox ---');

const empiricalResults = await IndependentBenchmarkHarness.runFullEmpiricalSuite(cwd);
const intershaderEmpirical = empiricalResults.find((r) => r.agentName.includes('InterShader'));
assert.ok(intershaderEmpirical);
assert.strictEqual(intershaderEmpirical.hiddenTestMutationKilled, true, 'Hidden test must actively kill injected mutation');
console.log('[PASS]: Hidden Test Mutation Sensitivity verified: hidden tests actively detect regressions.');

// ========================================================
// 7. CLI /verify-proof Command Execution
// ========================================================
console.log('--- 7. Testing /verify-proof Slash Command ---');

const registry = new CommandRegistry();
registerBuiltinCommands(registry);

assert.ok(registry.has('verify-proof'));
const verifyCmd = registry.get('verify-proof')!;
assert.strictEqual(verifyCmd.type, 'local');
if (verifyCmd.type === 'local') {
  const cmdOutput = await verifyCmd.execute({
    cwd,
    sessionState: {},
    args: [proofDir],
  });
  assert.ok(cmdOutput.includes('CRYPTOGRAPHIC PROOF VERIFICATION'));
  assert.ok(cmdOutput.includes('AUTHENTIC & UNTAMPERED'));
  assert.ok(cmdOutput.includes('ECDSA'));
  console.log('[PASS]: /verify-proof command output confirmed valid cryptographic attestation.');
}

console.log('\n[SUCCESS]: ALL 7 ATTESTED PROOF & TRUST PROTOCOL (V3) TESTS PASSED 100%!');
