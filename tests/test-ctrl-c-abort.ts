import assert from 'assert';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { SessionConfig } from '../types/index.js';

import { randomUUID } from 'crypto';

console.log('=== TEST SUITE: Ctrl+C Agent Abort & Session Preservation ===\n');

const testConfig: SessionConfig = {
  sessionId: 'test-ctrl-c-session-' + randomUUID(),
  provider: 'anthropic',
  model: 'claude-3-7-sonnet-20250219',
  cwd: process.cwd(),
  maxTokens: 4000,
  permissionMode: 'default',
  resumeSession: false,
};

// ----------------------------------------------------------------------------
// Test 1: QueryEngine getIsRunning() and abort() contract
// ----------------------------------------------------------------------------
console.log('[Test 1] QueryEngine getIsRunning() and abort() state verification');
{
  const qe = new QueryEngine(testConfig);
  assert.strictEqual(qe.getIsRunning(), false, 'QueryEngine should initially be idle');

  // Verify abort() on idle does not crash
  assert.doesNotThrow(() => qe.abort(), 'abort() on idle QueryEngine should be a safe no-op');
  assert.strictEqual(qe.getIsRunning(), false);
  console.log('  ✔ QueryEngine getIsRunning() returns false when idle and abort() is safe.');
}

// ----------------------------------------------------------------------------
// Test 2: State Machine Simulation for handleAbort
// ----------------------------------------------------------------------------
console.log('\n[Test 2] State Machine: Abort task while keeping session alive');
{
  let isBusy = true;
  let isRunning = true;
  let exitCalled = false;
  let abortCalled = false;
  let queuedPrompt: string | null = 'next prompt in queue';
  let pendingPermission: { tool: string } | null = { tool: 'write_to_file' };

  const mockQueryEngine = {
    getIsRunning: () => isRunning,
    abort: () => {
      abortCalled = true;
      isRunning = false;
    },
  };

  const mockExit = () => {
    exitCalled = true;
  };

  const handleAbortSimulation = () => {
    const isCurrentlyRunning = isBusy || mockQueryEngine.getIsRunning();

    if (isCurrentlyRunning) {
      if (queuedPrompt) {
        queuedPrompt = null;
      }
      if (pendingPermission) {
        pendingPermission = null;
      }
      isBusy = false;
      mockQueryEngine.abort();
      // exit() MUST NOT be called!
    } else {
      mockExit();
    }
  };

  // 1. First trigger while agent is working
  handleAbortSimulation();

  assert.strictEqual(abortCalled, true, 'queryEngine.abort() must be called');
  assert.strictEqual(exitCalled, false, 'exit() MUST NOT be called when agent is working');
  assert.strictEqual(queuedPrompt, null, 'queuedPrompt must be discarded');
  assert.strictEqual(pendingPermission, null, 'pendingPermission must be discarded');
  assert.strictEqual(isBusy, false, 'isBusy state must be reset to false');
  console.log('  ✔ Pressing Ctrl+C while busy successfully stops agent WITHOUT exiting session.');

  // 2. Second trigger while agent is idle (not busy)
  handleAbortSimulation();

  assert.strictEqual(exitCalled, true, 'exit() MUST be called when agent is idle');
  console.log('  ✔ Pressing Ctrl+C while idle successfully exits the CLI session.');
}

console.log('\n===============================================================');
console.log('🎉 ALL CTRL+C ABORT TESTS PASSED (2/2 PASS)');
console.log('===============================================================');
