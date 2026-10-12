import assert from 'assert';
import path from 'path';
import { CounterexampleAgent } from '../services/agent/CounterexampleAgent.js';
import { ClaudeAgentCoordinator } from '../services/agent/ClaudeAgentCoordinator.js';

console.log('[TEST]: Starting Counterexample Agent & Adversarial SWE Loop Tests...');

const cwd = process.cwd();

// 1. Test probing a file with potential concurrency or state issues
const report = CounterexampleAgent.probe({
  userIntent: 'Fix token refresh bug in authentication',
  modifiedFiles: ['cli/index.ts'],
  cwd,
});

assert.strictEqual(typeof report.attackSucceeded, 'boolean');
assert.strictEqual(typeof report.adversarialScore, 'number');
assert.ok(report.totalVectorsProbed >= 6);
assert.ok(report.summary.length > 0);
console.log(`[PASS]: CounterexampleAgent probed 6 vectors (Verdict: ${report.verdict}, Score: ${report.adversarialScore})`);

// 2. Test ClaudeAgentCoordinator integration with Counterexample role
const coordinator = new ClaudeAgentCoordinator();
const mockCtx = {
  sessionId: 'test-session',
  cwd,
  permissionMode: 'auto' as const,
};

const fullAdversarialReport = await coordinator.executeAdversarialSweLoop(
  'Refactor authentication session refresh',
  mockCtx,
  ['cli/index.ts']
);

assert.ok(fullAdversarialReport.steps.length === 5, 'Must contain 5 steps: explore, plan, general, verify, counterexample');
const counterStep = fullAdversarialReport.steps.find((s) => s.step === 'counterexample');
assert.ok(counterStep, 'Counterexample step must exist in workflow');
console.log(`[PASS]: Adversarial SWE Loop executed with 5 stages (Duration: ${fullAdversarialReport.durationMs}ms)`);

console.log('[SUCCESS]: ALL COUNTEREXAMPLE AGENT TESTS PASSED 100%!');
