import assert from 'assert';
import path from 'path';
import { ProofEngine } from '../engine/verification/ProofEngine.js';
import { ModelRouter } from '../orchestrator/ModelRouter.js';
import { ContextGraphEngine } from '../services/context/ContextGraphEngine.js';
import { AgentJudge } from '../services/agent/AgentJudge.js';
import { FailureKnowledgeGraph } from '../services/memory/FailureKnowledgeGraph.js';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';

console.log('[TEST]: Starting Autonomous Software Engineer verification (No PASS, No DONE)...');

const cwd = process.cwd();

// ==========================================
// 1. Verify ProofEngine (Proof Mode)
// ==========================================
console.log('--- 1. Verify ProofEngine & Proof Card ---');

const proofReport = await ProofEngine.verify(['cli/index.ts'], {
  cwd,
  skipBuild: true,
  skipTests: true,
  skipTypecheck: true,
  maxFilesBudget: 5,
});

assert.strictEqual(proofReport.overallPassed, true);
assert.strictEqual(proofReport.score, 100);
assert.strictEqual(proofReport.checks.length, 10);
assert.ok(proofReport.proofCard.includes('PROOF OF VERIFICATION: [PASS - VERIFIED]'));
assert.ok(proofReport.proofCard.includes('Scope & Diff Budget'));
assert.ok(proofReport.proofCard.includes('Security & Secret Scan'));
console.log('[PASS]: ProofEngine verified 10 checkpoints and exported ASCII Proof Card successfully');

// ==========================================
// 2. Verify ModelRouter (Dynamic Routing)
// ==========================================
console.log('--- 2. Verify Dynamic Model Router ---');

const reasoningRoute = ModelRouter.route({
  prompt: 'Refactor authentication state machine across 12 files to fix race condition deadlock',
  fileCount: 12,
});
assert.strictEqual(reasoningRoute.category, 'REASONING');
assert.ok(reasoningRoute.thinkingBudget && reasoningRoute.thinkingBudget >= 4096);
console.log(`[PASS]: Complex task accurately routed: ${reasoningRoute.category} (${reasoningRoute.recommendedModel})`);

const reviewRoute = ModelRouter.route({
  prompt: 'Review this diff and audit for security injection vulnerability',
  isAudit: true,
});
assert.strictEqual(reviewRoute.category, 'REVIEW');
console.log(`[PASS]: Security task accurately routed: ${reviewRoute.category} (${reviewRoute.recommendedModel})`);

const fastRoute = ModelRouter.route({
  prompt: 'explain this function',
});
assert.strictEqual(fastRoute.category, 'FAST');
console.log(`[PASS]: Fast lookup task accurately routed: ${fastRoute.category} (${fastRoute.recommendedModel})`);

const codingRoute = ModelRouter.route({
  prompt: 'implement user profile update route',
});
assert.strictEqual(codingRoute.category, 'CODING');
console.log(`[PASS]: Standard coding task accurately routed: ${codingRoute.category} (${codingRoute.recommendedModel})`);

// ==========================================
// 3. Verify ContextGraphEngine (Selective Slicing)
// ==========================================
console.log('--- 3. Verify ContextGraphEngine ---');

const contextSlice = ContextGraphEngine.assembleFocusedContext(
  'Fix token expiration in auth service',
  ['services/lsp/NativeCodeIntelligence.ts'],
  cwd,
  500
);

assert.ok(contextSlice.primaryFiles.includes('services/lsp/NativeCodeIntelligence.ts'));
assert.ok(contextSlice.symbolsInScope.length > 0);
assert.ok(contextSlice.formattedContextMarkdown.includes('FOCUSED ARCHITECTURAL CONTEXT SLICE'));
console.log(`[PASS]: ContextGraphEngine selectively sliced context (${contextSlice.symbolsInScope.length} symbols, ${contextSlice.totalLines} lines)`);

// ==========================================
// 4. Verify Independent Agent Judge
// ==========================================
console.log('--- 4. Verify Independent Agent Judge ---');

// Valid submission
const validSubmission = {
  userIntent: 'Fix login token expiration bug',
  modifiedFiles: ['src/auth/token.ts'],
  allowedFiles: ['src/auth/token.ts', 'src/auth/user.ts'],
  testResults: { total: 10, passed: 10, failed: 0 },
  buildPassed: true,
  secretLeaksDetected: 0,
};

const acceptedJudge = AgentJudge.evaluate(validSubmission);
assert.strictEqual(acceptedJudge.verdict, 'ACCEPT');
assert.strictEqual(acceptedJudge.isAccepted, true);
assert.strictEqual(acceptedJudge.tierClassification, 'EXCELLENT');
assert.ok(acceptedJudge.overallScore >= AgentJudge.ACCEPTANCE_THRESHOLD);
console.log(`[PASS]: Judge accepted valid solution: Score ${acceptedJudge.overallScore}/100 (${acceptedJudge.tierClassification})`);

// Broken submission (build failure, test failures, out-of-bounds file edit)
const brokenSubmission = {
  userIntent: 'Fix login token expiration bug',
  modifiedFiles: ['src/auth/token.ts', 'forbidden/secret.env'],
  allowedFiles: ['src/auth/token.ts'],
  testResults: { total: 10, passed: 7, failed: 3 },
  buildPassed: false,
  secretLeaksDetected: 1,
};

const rejectedJudge = AgentJudge.evaluate(brokenSubmission);
assert.strictEqual(rejectedJudge.verdict, 'REJECT');
assert.strictEqual(rejectedJudge.isAccepted, false);
assert.strictEqual(rejectedJudge.tierClassification, 'REJECT');
assert.ok(rejectedJudge.criticalDefects.length >= 3);
console.log(`[PASS]: Judge accurately rejected broken solution via Hard Constraints: Score ${rejectedJudge.overallScore}/100 (${rejectedJudge.criticalDefects.length} critical defects)`);

// ==========================================
// 5. Verify Failure Knowledge Graph
// ==========================================
console.log('--- 5. Verify Failure Knowledge Graph ---');

FailureKnowledgeGraph.recordFailure(
  {
    failureType: 'UnsupportedClassVersionError',
    errorMessage: 'UnsupportedClassVersionError: class file version 65.0, this runtime only recognizes class file versions up to 61.0',
    rootCause: 'Java 21 bytecode executed on Java 17 runtime mismatch',
    effectiveResolution: 'Configure gradle toolchain to target Java 17 or update JAVA_HOME to JDK 21',
  },
  'test-project'
);

const matchedFailures = FailureKnowledgeGraph.lookupSimilarFailures('UnsupportedClassVersionError Java runtime mismatch', 1);
assert.ok(matchedFailures.length > 0);
assert.ok(matchedFailures[0].rootCause.includes('Java 21'));
assert.ok(matchedFailures[0].effectiveResolution.includes('Java 17'));
console.log(`[PASS]: FailureKnowledgeGraph queried known resolution accurately: "${matchedFailures[0].effectiveResolution}"`);

// ==========================================
// 6. Verify Slash Commands /proof and /route
// ==========================================
console.log('--- 6. Verify Slash Commands /proof and /route ---');

const registry = new CommandRegistry();
registerBuiltinCommands(registry);

assert.ok(registry.has('proof'));
assert.ok(registry.has('route'));

const proofCmd = registry.get('proof')!;
if (proofCmd.type === 'local') {
  const card = await proofCmd.execute({ cwd, sessionState: {}, args: ['cli/index.ts'] });
  assert.ok(card.includes('PROOF OF VERIFICATION'));
  console.log('[PASS]: /proof command executed successfully');
}

const routeCmd = registry.get('route')!;
if (routeCmd.type === 'local') {
  const routeRes = await routeCmd.execute({ cwd, sessionState: {}, args: ['Refactor', 'database', 'layer'] });
  assert.ok(routeRes.includes('DYNAMIC MULTI-MODEL ROUTER'));
  console.log('[PASS]: /route command rendered model routing decision accurately');
}

console.log('[SUCCESS]: ALL AUTONOMOUS SOFTWARE ENGINEER TESTS PASSED 100%!');
