import assert from 'assert';
import { RuleMatcher } from '../security/RuleMatcher.js';
import { PermissionEngine } from '../security/PermissionEngine.js';

console.log('[TEST]: Starting Permission Engine & Rule Matcher Tests...');

// 1. Test RuleMatcher parsing and wildcard evaluation
const parsedBash = RuleMatcher.parseRule('run_shell_command(git commit *)', true);
assert.strictEqual(parsedBash.toolName, 'run_shell_command');
assert.strictEqual(parsedBash.argPattern, 'git commit *');

const isMatch1 = RuleMatcher.matches(parsedBash, 'run_shell_command', { command: 'git commit -m "feat: login"' });
assert.strictEqual(isMatch1, true);

const isMatch2 = RuleMatcher.matches(parsedBash, 'run_shell_command', { command: 'rm -rf dist' });
assert.strictEqual(isMatch2, false);

const parsedEdit = RuleMatcher.parseRule('file_edit(src/**)', true);
const isEditMatch = RuleMatcher.matches(parsedEdit, 'file_edit', { path: 'src/components/Header.tsx' });
assert.strictEqual(isEditMatch, true);
console.log('[PASS]: RuleMatcher parsing and wildcard matching verified');

// 2. Test PermissionEngine: Plan Mode (strictly read-only)
const planEngine = new PermissionEngine('plan');
const readInPlan = planEngine.evaluate('file_read', { path: 'src/index.ts' }, true, false);
assert.strictEqual(readInPlan.allowed, true);

const writeInPlan = planEngine.evaluate('file_write', { path: 'src/index.ts' }, false, false);
assert.strictEqual(writeInPlan.allowed, false);
assert.ok(writeInPlan.reason.includes('Plan Mode'));
console.log('[PASS]: Plan Mode permission enforcement verified');

// 3. Test PermissionEngine: acceptEdits Mode
const acceptEngine = new PermissionEngine('acceptEdits');
const editInAccept = acceptEngine.evaluate('file_edit', { path: 'src/app.ts' }, false, false);
assert.strictEqual(editInAccept.allowed, true);
assert.ok(editInAccept.reason.includes('acceptEdits'));

const destructiveInAccept = acceptEngine.evaluate('run_shell_command', { command: 'del /f /s /q test' }, false, true);
assert.strictEqual(destructiveInAccept.allowed, false);
assert.strictEqual(destructiveInAccept.requiresPrompt, true);
console.log('[PASS]: acceptEdits Mode permission enforcement verified');

// 4. Test PermissionEngine: bypassPermissions Mode
const bypassEngine = new PermissionEngine('bypassPermissions');
const anyInBypass = bypassEngine.evaluate('run_shell_command', { command: 'rm -rf tmp' }, false, true);
assert.strictEqual(anyInBypass.allowed, true);
console.log('[PASS]: bypassPermissions Mode verified');

// 5. Test PermissionEngine: dontAsk Mode
const dontAskEngine = new PermissionEngine('dontAsk');
const safeDontAsk = dontAskEngine.evaluate('file_read', { path: 'src/index.ts' }, true, false);
assert.strictEqual(safeDontAsk.allowed, true);

const dangerDontAsk = dontAskEngine.evaluate('run_shell_command', { command: 'rm -rf node_modules' }, false, true);
assert.strictEqual(dangerDontAsk.allowed, false);
assert.strictEqual(dangerDontAsk.requiresPrompt, false);
console.log('[PASS]: dontAsk Mode auto-denial verified');

// 6. Test Explicit Deny and Allow Rules overriding mode
const customEngine = new PermissionEngine('default');
customEngine.addDenyRule('run_shell_command(rm -rf *)');
customEngine.addAllowRule('run_shell_command(git status)');

const deniedCommand = customEngine.evaluate('run_shell_command', { command: 'rm -rf build' }, false, false);
assert.strictEqual(deniedCommand.allowed, false);
assert.ok(deniedCommand.reason.includes('deny rule'));

const allowedCommand = customEngine.evaluate('run_shell_command', { command: 'git status' }, false, false);
assert.strictEqual(allowedCommand.allowed, true);
assert.ok(allowedCommand.reason.includes('allow rule'));
console.log('[PASS]: Explicit Deny & Allow rule overrides verified');

console.log('[SUCCESS]: All Permission Engine & Rule Matcher Tests PASSED!');
