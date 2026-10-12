import assert from 'assert';
import {
  CommandRegistry,
  registerBuiltinCommands,
  reviewCommand,
  commitCommand,
  diffCommand,
  statsCommand,
  costCommand,
} from '../cli/commands/index.js';

console.log('[TEST]: Starting Slash Command Registry Tests...');

// 1. Setup Registry
const registry = new CommandRegistry();
registerBuiltinCommands(registry);

// 2. Verify registered commands count and lookup
assert.ok(registry.has('review'), 'Should have review command');
assert.ok(registry.has('commit'), 'Should have commit command');
assert.ok(registry.has('diff'), 'Should have diff command');
assert.ok(registry.has('stats'), 'Should have stats command');
assert.ok(registry.has('cost'), 'Should have cost command');
assert.ok(registry.has('audit'), 'Should resolve alias audit -> review');
assert.ok(registry.has('tokens'), 'Should resolve alias tokens -> stats');
console.log('[PASS]: Command registration and alias resolution verified');

// 3. Test Input Parsing
const parsed = registry.parseInput('/commit "feat: add oauth" --dry-run');
assert.ok(parsed);
assert.strictEqual(parsed.commandName, 'commit');
assert.strictEqual(parsed.args.length, 2);
console.log('[PASS]: Slash command input parsing verified');

// 4. Test PromptCommand expansion
const mockCtx = {
  cwd: process.cwd(),
  sessionState: { totalInputTokens: 50000, totalOutputTokens: 10000 },
  args: ['src/auth/SessionStore.ts'],
};

// 4. Test PromptCommand expansion
async function runCommandTests() {
  const promptResult = await reviewCommand.getPrompt(mockCtx);
  assert.ok(promptResult.includes('systematic code review of src/auth/SessionStore.ts'));
  console.log('[PASS]: PromptCommand expansion verified');

  // 5. Test LocalCommand execution (stats & cost)
  const statsResult = await statsCommand.execute(mockCtx);
  assert.ok(statsResult.includes('Input Tokens:  50,000'));
  assert.ok(statsResult.includes('Output Tokens: 10,000'));

  const costResult = await costCommand.execute(mockCtx);
  assert.ok(costResult.includes('Estimated Session Cost:'));
  console.log('[PASS]: LocalCommand stats and cost execution verified');

  console.log('[SUCCESS]: All Slash Command Registry Tests PASSED!');
}

runCommandTests().catch((err) => {
  console.error('[FAIL]:', err);
  process.exit(1);
});
