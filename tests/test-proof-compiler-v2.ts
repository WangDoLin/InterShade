import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { EvidenceStore } from '../engine/verification/EvidenceStore.js';
import { TestTamperDetector } from '../engine/verification/TestTamperDetector.js';
import { MutationVerifier } from '../engine/verification/MutationVerifier.js';
import { CounterexampleAgent } from '../services/agent/CounterexampleAgent.js';
import { CapabilityModelRegistry } from '../engine/routing/CapabilityModelRegistry.js';
import { ModelTournament } from '../engine/routing/ModelTournament.js';
import { FailureKnowledgeGraph } from '../services/memory/FailureKnowledgeGraph.js';
import { IndependentBenchmarkHarness } from '../engine/benchmark/IndependentBenchmarkHarness.js';
import { UniversalVerificationAdapter } from '../engine/verification/UniversalVerificationAdapter.js';

console.log('[TEST]: Starting InterShader Proof Compiler v2.0 Comprehensive Test Suite...');

const cwd = process.cwd();

// ==========================================
// 1. EvidenceStore & ProofEngine Verification
// ==========================================
console.log('--- 1. Testing EvidenceStore & ProofEngine ---');

const proofReport = await ProofEngine.verify(['cli/index.ts'], {
  cwd,
  skipBuild: true,
  skipTests: true,
  skipTypecheck: true,
  maxFilesBudget: 5,
});

assert.strictEqual(proofReport.overallPassed, true);
assert.ok(proofReport.runId.startsWith('run-'));
assert.ok(proofReport.manifest !== undefined);
assert.ok(proofReport.manifest.manifestHashSha256.length === 64);
assert.ok(proofReport.checks.length === 10);

// Check that artifact logs actually exist on disk
const manifestDir = path.join(cwd, '.intershader', 'proof', proofReport.runId);
assert.ok(fs.existsSync(manifestDir), 'Proof directory must be created on disk');
assert.ok(fs.existsSync(path.join(manifestDir, 'manifest.json')), 'manifest.json must be persisted');
assert.ok(fs.existsSync(path.join(manifestDir, 'g1-scope.log')), 'g1-scope.log must exist');

// Verify Proof Card contains SHA-256 and Run ID
assert.ok(proofReport.proofCard.includes('Run ID:'));
assert.ok(proofReport.proofCard.includes('SHA-256 Digest:'));
console.log(`[PASS]: ProofEngine verified with real disk artifacts & SHA-256: ${proofReport.manifest.manifestHashSha256.slice(0, 16)}...`);

// ==========================================
// 2. Test Tamper Detection
// ==========================================
console.log('--- 2. Testing TestTamperDetector ---');

// Case A: Unauthorized test modification
const tamperReportA = TestTamperDetector.audit(
  cwd,
  ['tests/test-counterexample-agent.ts'],
  ['cli/index.ts'] // not allowed to edit test
);
assert.strictEqual(tamperReportA.isTampered, true);
assert.ok(tamperReportA.tamperedFiles.includes('tests/test-counterexample-agent.ts'));
console.log('[PASS]: TestTamperDetector correctly blocked unauthorized test modification.');

// Case B: Authorized modification with clean assertions
const tamperReportB = TestTamperDetector.audit(
  cwd,
  ['tests/test-counterexample-agent.ts'],
  ['tests/test-counterexample-agent.ts']
);
assert.strictEqual(tamperReportB.isTampered, false);
console.log('[PASS]: TestTamperDetector approved authorized clean test modifications.');

// ==========================================
// 3. Mutation Verification Logic
// ==========================================
console.log('--- 3. Testing MutationVerifier Logic ---');

const dummyMutationReport = await MutationVerifier.verify(['cli/index.ts'], {
  cwd,
  testCommand: 'node -e "process.exit(0)"',
  maxMutants: 1,
});
assert.strictEqual(typeof dummyMutationReport.adequacyScore, 'number');
assert.ok(dummyMutationReport.mutantsTested >= 0);
console.log(`[PASS]: MutationVerifier completed verification (Tested: ${dummyMutationReport.mutantsTested}, Adequacy: ${dummyMutationReport.adequacyScore}%).`);

// ==========================================
// 4. 14-Vector Counterexample Agent
// ==========================================
console.log('--- 4. Testing 14-Vector Counterexample Agent ---');

const counterReport = CounterexampleAgent.probe({
  userIntent: 'Fix token refresh race condition and handle null state',
  modifiedFiles: ['cli/index.ts'],
  cwd,
});
assert.strictEqual(counterReport.totalVectorsProbed, 14, 'Must probe all 14 vectors');
assert.strictEqual(typeof counterReport.adversarialScore, 'number');
assert.ok(counterReport.summary.includes('14'));
console.log(`[PASS]: CounterexampleAgent probed 14 attack vectors (Score: ${counterReport.adversarialScore}/100).`);

// ==========================================
// 5. CapabilityModelRegistry & ModelTournament
// ==========================================
console.log('--- 5. Testing CapabilityModelRegistry & ModelTournament ---');

// Test A: Dynamic Capability Selection
const largeContextModel = CapabilityModelRegistry.selectBestModel({
  prompt: 'Analyze huge 400-file repository',
  estimatedTokens: 300_000,
});
assert.strictEqual(largeContextModel.id, 'gemini-3.8-flash', 'Gemini 3.8 Flash must be selected for >150k context');

const securityModel = CapabilityModelRegistry.selectBestModel({
  prompt: 'Audit smart contract permissions for reentrancy',
  isSecurityAudit: true,
  fileCount: 8,
});
assert.ok(securityModel.capabilities.has('security_audit'));
console.log(`[PASS]: CapabilityModelRegistry selected: ${largeContextModel.name} and ${securityModel.name}`);

// Test B: Model Tournament
const tournament = ModelTournament.evaluateTournament(
  'TASK-TOURNEY-1',
  'Refactor authentication session refresh',
  [
    {
      modelId: 'gemini-3.8-flash',
      modelName: 'Gemini 3.8 Flash',
      provider: 'gemini',
      patchDescription: 'Thread-safe atomic token swap with mutex',
      modifiedFiles: ['cli/index.ts'],
      simulatedTestResults: { total: 20, passed: 20, failed: 0 },
      buildPassed: true,
    },
    {
      modelId: 'naive-agent',
      modelName: 'Naive Agent',
      provider: 'unknown',
      patchDescription: 'Direct variable assignment',
      modifiedFiles: ['cli/index.ts', 'outside/secret.env'], // Breaches allowed boundary
      simulatedTestResults: { total: 20, passed: 15, failed: 5 },
      buildPassed: false,
    },
  ],
  cwd,
  ['cli/index.ts']
);

assert.strictEqual(tournament.winnerModelId, 'gemini-3.8-flash');
assert.strictEqual(tournament.evaluations[0].verdict, 'WINNER');
assert.strictEqual(tournament.evaluations[1].verdict, 'DISQUALIFIED');
console.log(`[PASS]: ModelTournament correctly chose ${tournament.winnerModelName} (Score: ${tournament.evaluations[0].compositeEvidenceScore}/100) and disqualified failed patch.`);

// ==========================================
// 6. Enriched FailureKnowledgeGraph v2
// ==========================================
console.log('--- 6. Testing Enriched FailureKnowledgeGraph v2 ---');

FailureKnowledgeGraph.recordFailure(
  {
    failureType: 'ConcurrentTokenMutationRace',
    errorMessage: 'RaceConditionError: double refresh detected on token swap',
    rootCause: 'Lack of atomic mutex lock during parallel token refresh calls',
    effectiveResolution: 'Wrap token exchange in mutex promise deduplicator',
    environment: {
      runtime: 'node',
      version: '22.13.0',
      os: 'win32',
    },
    dependencyFingerprint: 'typescript@5.8.2',
    verifiedProjectsCount: 14,
    successRate: 98.5,
    confidenceScore: 0.99,
  },
  'test-project-v2'
);

const matchedFailures = FailureKnowledgeGraph.lookupSimilarFailures('double refresh detected on token swap', 1);
assert.ok(matchedFailures.length > 0);
assert.ok(matchedFailures[0].rootCause.includes('atomic mutex lock'));
assert.strictEqual(matchedFailures[0].verifiedProjectsCount, 14);
assert.strictEqual(matchedFailures[0].successRate, 98.5);
console.log(`[PASS]: FailureKnowledgeGraph v2 retrieved enriched incident: ${matchedFailures[0].effectiveResolution} (Confidence: ${matchedFailures[0].confidenceScore})`);

// ==========================================
// 7. Independent Benchmark Harness (Anti-Self-Certification)
// ==========================================
console.log('--- 7. Testing Independent Benchmark Harness (Sandbox Execution) ---');

const empiricalResults = await IndependentBenchmarkHarness.runFullEmpiricalSuite(cwd);
assert.ok(empiricalResults.length >= 2);

const verifiedResult = empiricalResults.find((r) => r.agentName.includes('InterShader'));
assert.ok(verifiedResult, 'InterShader result must exist in empirical benchmark');
assert.strictEqual(verifiedResult.redPhaseConfirmed, true, 'Defect must be confirmed before fix');
assert.strictEqual(verifiedResult.greenPhasePassed, true, 'Public tests must pass');
assert.strictEqual(verifiedResult.hiddenTestsPassed, true, 'Hidden edge-case tests must pass');
assert.strictEqual(verifiedResult.verdict, 'PASS');

const baselineResult = empiricalResults.find((r) => r.agentName.includes('Vanilla'));
assert.ok(baselineResult);
assert.strictEqual(baselineResult.verdict, 'FAIL', 'Unfixed baseline must fail hidden tests');
console.log(`[PASS]: Independent Sandbox Benchmark passed with 0 self-certification (InterShader score: ${verifiedResult.empiricalScore}/100, Baseline: ${baselineResult.empiricalScore}/100).`);

// ==========================================
// 8. Universal Verification Adapter
// ==========================================
console.log('--- 8. Testing Universal Verification Adapter ---');

const universalReport = await UniversalVerificationAdapter.verify({
  cwd,
  userIntent: 'Universal oracle verification of workspace boundary',
  changedFiles: ['cli/index.ts'],
  allowedFiles: ['cli/index.ts'],
  skipMutation: true,
});

assert.strictEqual(typeof universalReport.isVerified, 'boolean');
assert.ok(universalReport.proofCard.includes('PROOF OF VERIFICATION'));
assert.ok(universalReport.tamperReport.isTampered === false);
assert.ok(universalReport.counterexampleReport.totalVectorsProbed === 14);
console.log(`[PASS]: Universal Verification Oracle completed (Verdict: ${universalReport.verdict}).`);

console.log('\n[SUCCESS]: ALL 8 INTERSHADER PROOF COMPILER V2.0 TESTS PASSED 100%!');
