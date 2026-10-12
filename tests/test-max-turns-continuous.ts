import assert from 'node:assert';
import { config } from '../config/index.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { CommandRegistry } from '../cli/commands/CommandRegistry.js';
import { registerBuiltinCommands, turnsCommand } from '../cli/commands/builtinCommands.js';

console.log('=== Test 1: Config Max Turns Default ===');
assert.strictEqual(typeof config.maxTurns, 'number');
assert.ok(config.maxTurns >= 100, 'Default max turns should be >= 100');
console.log(`[PASS] Config maxTurns default: ${config.maxTurns}`);

console.log('=== Test 2: QueryEngine Max Turns Lifecycle ===');
const engine = new QueryEngine({
  provider: 'openai',
  model: 'gpt-4o',
  cwd: process.cwd(),
  maxTokens: 100000,
  permissionMode: 'default',
  resumeSession: false,
});

assert.strictEqual(engine.getMaxTurns(), config.maxTurns);
engine.updateMaxTurns(150);
assert.strictEqual(engine.getMaxTurns(), 150);
engine.updateMaxTurns(0);
assert.strictEqual(engine.getMaxTurns(), 0);
console.log('[PASS] QueryEngine maxTurns get/update operational');

console.log('=== Test 3: turnsCommand Execution ===');
const fakeSessionState: Record<string, unknown> = {
  maxTurns: 100,
};

// 3a. Query current limit
const res1 = turnsCommand.execute({
  args: [],
  cwd: process.cwd(),
  sessionState: fakeSessionState,
});
assert.ok(typeof res1 === 'string' && res1.includes('100 turns'));
console.log(`[PASS] Query returns: ${res1}`);

// 3b. Update limit to 75
const res2 = turnsCommand.execute({
  args: ['75'],
  cwd: process.cwd(),
  sessionState: fakeSessionState,
});
assert.strictEqual(fakeSessionState.maxTurns, 75);
assert.ok(typeof res2 === 'string' && res2.includes('75 turns'));
console.log(`[PASS] Update returns: ${res2}`);

// 3c. Update to unlimited
const res3 = turnsCommand.execute({
  args: ['unlimited'],
  cwd: process.cwd(),
  sessionState: fakeSessionState,
});
assert.strictEqual(fakeSessionState.maxTurns, 0);
assert.ok(typeof res3 === 'string' && res3.includes('Unlimited'));
console.log(`[PASS] Unlimited returns: ${res3}`);

// 3d. Update to 0 (also unlimited)
const res4 = turnsCommand.execute({
  args: ['0'],
  cwd: process.cwd(),
  sessionState: fakeSessionState,
});
assert.strictEqual(fakeSessionState.maxTurns, 0);
assert.ok(typeof res4 === 'string' && res4.includes('Unlimited'));
console.log(`[PASS] 0 returns: ${res4}`);

console.log('=== Test 4: Command Registry Integration ===');
const registry = new CommandRegistry();
registerBuiltinCommands(registry);
const cmd = registry.get('turns');
assert.ok(cmd, 'turnsCommand must be registered in CommandRegistry');
assert.strictEqual(cmd?.name, 'turns');
const parsed = registry.parseInput('/turns 200');
assert.ok(parsed);
assert.strictEqual(parsed?.commandName, 'turns');
assert.deepStrictEqual(parsed?.args, ['200']);
console.log('[PASS] turns command registered and parsed successfully');

console.log('\nAll Max Turns & Continuous Execution Tests PASSED!');
