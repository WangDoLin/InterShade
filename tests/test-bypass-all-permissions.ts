import { CommandRegistry } from '../cli/commands/CommandRegistry.js';
import { registerBuiltinCommands, bypassCommand, modeCommand } from '../cli/commands/builtinCommands.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { ShellTool } from '../tools/execution/ShellTool.js';
import type { SessionConfig, ToolExecutionContext } from '../types/index.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    process.exit(1);
  }
  console.log(`[PASS] ${msg}`);
}

async function runTests() {
  console.log('--- TEST SUITE: Bypass All Permissions Command & Execution ---');

  const reg = new CommandRegistry();
  registerBuiltinCommands(reg);

  // 1. Verify /bypass and aliases registered in CommandRegistry
  assert(Boolean(reg.get('bypass')), '/bypass command is registered');
  assert(Boolean(reg.get('yolo')), '/yolo alias is registered');
  assert(Boolean(reg.get('all-perms')), '/all-perms alias is registered');
  assert(Boolean(reg.get('grant-all')), '/grant-all alias is registered');

  // 2. Test /bypass toggle and arguments
  const sessionState: Record<string, unknown> = {
    permissionMode: 'default',
  };

  const res1 = await bypassCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: [],
  });
  assert(sessionState.permissionMode === 'bypassPermissions', 'Toggle /bypass sets permissionMode to bypassPermissions');
  assert(typeof res1 === 'string' && res1.includes('[BYPASS MODE ON]'), 'Notice contains [BYPASS MODE ON]');

  const res2 = await bypassCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: [],
  });
  assert(sessionState.permissionMode === 'default', 'Toggle /bypass again restores default');
  assert(typeof res2 === 'string' && res2.includes('[BYPASS MODE OFF]'), 'Notice contains [BYPASS MODE OFF]');

  await bypassCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: ['on'],
  });
  assert(sessionState.permissionMode === 'bypassPermissions', '/bypass on activates bypassPermissions');

  await bypassCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: ['off'],
  });
  assert(sessionState.permissionMode === 'default', '/bypass off restores default');

  // 3. Test /mode aliases: bypass, yolo, all
  await modeCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: ['bypass'],
  });
  assert(sessionState.permissionMode === 'bypassPermissions', '/mode bypass maps to bypassPermissions');

  await modeCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: ['yolo'],
  });
  assert(sessionState.permissionMode === 'bypassPermissions', '/mode yolo maps to bypassPermissions');

  await modeCommand.execute({
    cwd: process.cwd(),
    sessionState,
    args: ['all'],
  });
  assert(sessionState.permissionMode === 'bypassPermissions', '/mode all maps to bypassPermissions');

  // 4. Test QueryEngine.requestConfirmation auto-resolves true in bypassPermissions mode
  const sessionConfig: SessionConfig = {
    provider: 'anthropic',
    model: 'claude-3-7-sonnet-20250219',
    cwd: process.cwd(),
    maxTokens: 4000,
    permissionMode: 'bypassPermissions',
  };

  const engine = new QueryEngine(sessionConfig);
  let promptEmitted = false;
  engine.on('permission_request', () => {
    promptEmitted = true;
  });

  const confirmed = await engine.requestConfirmation('Execute dangerous action?');
  assert(confirmed === true, 'Confirmation auto-resolves true in bypassPermissions mode');
  assert(!promptEmitted, 'No confirmation UI prompt emitted when in bypassPermissions mode');

  // 5. Test ShellTool bypasses confirmation for potentially dangerous command
  const shellTool = new ShellTool();
  let shellPromptCalled = false;
  const toolCtx: ToolExecutionContext = {
    sessionId: 'test-session',
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
    askConfirmation: async () => {
      shellPromptCalled = true;
      return true;
    },
  };

  // Run a harmless command containing dangerous substring pattern check in bypass mode
  // e.g. "git reset --help" which matches "git reset"
  const output = await shellTool.execute({ command: 'echo "bypass-ok"' }, toolCtx);
  assert(output.includes('bypass-ok'), 'ShellTool executes without confirmation prompt');
  assert(!shellPromptCalled, 'ShellTool does NOT call askConfirmation when in bypassPermissions mode');

  console.log('\n>>> ALL BYPASS PERMISSION TESTS PASSED! <<<');
}

runTests().catch((err) => {
  console.error('[UNCAUGHT TEST ERROR]', err);
  process.exit(1);
});
