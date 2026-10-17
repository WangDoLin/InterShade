import assert from 'node:assert/strict';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';
import { MultiSessionPool } from '../engine/swarm/MultiSessionPool.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { SessionConfig } from '../types/index.js';

async function runTabAndCommandExecutionTests() {
  console.log('================================================================');
  console.log(' TEST: DIRECT COMMAND EXECUTION & MULTI-SESSION TAB CONCURRENCY ');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // Test 1: CommandRegistry ParseInput (Prefixed & Unprefixed CLI)
  // -------------------------------------------------------------
  console.log('=== TEST 1: COMMAND REGISTRY PARSE INPUT ===');
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  // 1a. Slash commands with leading '/'
  const parsed1 = registry.parseInput('/tab new "worker-backend"');
  assert.ok(parsed1, 'Should parse /tab command');
  assert.strictEqual(parsed1.commandName, 'tab');
  assert.deepStrictEqual(parsed1.args, ['new', 'worker-backend']);

  // 1b. Unprefixed CLI commands (e.g. "tab new worker")
  const parsed2 = registry.parseInput('tab new worker-frontend');
  assert.ok(parsed2, 'Should parse unprefixed "tab new"');
  assert.strictEqual(parsed2.commandName, 'tab');
  assert.deepStrictEqual(parsed2.args, ['new', 'worker-frontend']);

  // 1c. Unprefixed status and help
  const parsedStatus = registry.parseInput('status');
  assert.ok(parsedStatus, 'Should parse unprefixed "status"');
  assert.strictEqual(parsedStatus.commandName, 'status');

  const parsedHelp = registry.parseInput('help');
  assert.ok(parsedHelp, 'Should parse unprefixed "help"');
  assert.strictEqual(parsedHelp.commandName, 'help');

  // 1d. Regular natural language prompts must NOT be parsed as commands
  const notCmd1 = registry.parseInput('Can you explain how this tab works in our project?');
  assert.strictEqual(notCmd1, null, 'Regular question should not be parsed as command');

  const notCmd2 = registry.parseInput('Please review the auth service implementation');
  assert.strictEqual(notCmd2, null, 'Natural sentence starting with Please should return null');

  console.log('[PASS]: CommandRegistry parseInput distinguishes commands and natural prompts.');

  // -------------------------------------------------------------
  // Test 2: Tab Command Execution & Automatic Viewport Switching
  // -------------------------------------------------------------
  console.log('\n=== TEST 2: TAB NEW EXECUTION & AUTO SWITCH ===');
  MultiSessionPool.resetInstance();
  const pool = MultiSessionPool.getInstance();

  const mockConfig: SessionConfig = {
    sessionId: 'primary-session-' + Date.now(),
    cwd: process.cwd(),
    model: 'gemini-2.5-flash',
    provider: 'google',
    permissionMode: 'default',
    resumeSession: false,
    maxTokens: 100_000,
    maxTurns: 10,
  };
  const primaryEngine = new QueryEngine(mockConfig);
  pool.initPrimary(primaryEngine, 'Primary Workspace');

  assert.strictEqual(pool.getTabs().length, 1);
  assert.strictEqual(pool.getActiveTab().title, 'Primary Workspace');

  const tabCmd = registry.get('tab');
  assert.ok(tabCmd && tabCmd.type === 'local', 'tab command must be registered as local command');

  // Execute "tab new Secondary Worker"
  const tabResult = await tabCmd.execute({
    cwd: process.cwd(),
    sessionState: primaryEngine.getSessionState() as unknown as Record<string, unknown>,
    args: ['new', 'Secondary Worker'],
  });

  console.log('Tab Creation Output:\n', tabResult, '\n');
  assert.ok(tabResult.includes('Successfully created and switched to Tab 2'), 'Output must confirm creation and switch');

  // Verify pool state: 2 tabs exist, active tab is now Tab 2
  assert.strictEqual(pool.getTabs().length, 2, 'Pool must contain 2 session tabs');
  const activeTab = pool.getActiveTab();
  assert.strictEqual(activeTab.title, 'Secondary Worker', 'Active tab must be automatically switched to new tab');
  assert.strictEqual(activeTab.status, 'idle', 'New tab status must be idle and ready for prompts');
  console.log('[PASS]: Tab creation automatically switches active viewport for immediate concurrent usage.');

  // -------------------------------------------------------------
  // Test 3: Local Command Bypasses Busy Prompt Queue
  // -------------------------------------------------------------
  console.log('\n=== TEST 3: LOCAL COMMAND EXECUTION WHILE BUSY ===');

  let isBusyState = true; // Primary agent is currently busy running a long task
  let queuedPromptVar: string | null = null;
  let executedLocally = false;

  async function simulateHandleUserSubmit(input: string) {
    const parsed = registry.parseInput(input);
    if (parsed) {
      const cmd = registry.get(parsed.commandName);
      if (cmd && cmd.type === 'local') {
        // Local command executes immediately regardless of isBusyState!
        executedLocally = true;
        await cmd.execute({
          cwd: process.cwd(),
          sessionState: {},
          args: parsed.args,
        });
        return;
      }
    }

    // Regular prompt logic
    if (isBusyState) {
      queuedPromptVar = input.trim();
      return;
    }
  }

  // 3a. User types "tab list" while agent is busy
  await simulateHandleUserSubmit('tab list');
  assert.strictEqual(executedLocally, true, 'Local command should execute immediately');
  assert.strictEqual(queuedPromptVar, null, 'Local command must NEVER be trapped in prompt queue');

  // 3b. User types a regular prompt while agent is busy
  await simulateHandleUserSubmit('Fix the database connection pooling bug');
  assert.strictEqual(queuedPromptVar, 'Fix the database connection pooling bug', 'Regular prompt must be queued when busy');
  console.log('[PASS]: Local commands bypass prompt queue when agent is busy.');

  console.log('\n================================================================');
  console.log(' ALL TAB & COMMAND EXECUTION TESTS PASSED (100%)! 🎉            ');
  console.log('================================================================');
}

runTabAndCommandExecutionTests().catch((err) => {
  console.error('[FAIL]: Test suite failed:', err);
  process.exit(1);
});
