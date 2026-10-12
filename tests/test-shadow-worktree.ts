import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ShadowWorktree } from '../security/ShadowWorktree.js';

console.log('[TEST]: Starting Git Shadow Worktree Sandbox verification...');

const cwd = process.cwd();
const sandboxDir = path.join(cwd, '.intershader', 'test-sandbox-repo');
if (fs.existsSync(sandboxDir)) {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
}
fs.mkdirSync(sandboxDir, { recursive: true });

// 1. Initialize mock Git repository for testing
execSync('git init', { cwd: sandboxDir, stdio: 'ignore' });
execSync('git config user.name "InterShaderTest"', { cwd: sandboxDir, stdio: 'ignore' });
execSync('git config user.email "test@intershade.dev"', { cwd: sandboxDir, stdio: 'ignore' });

const mainFile = path.join(sandboxDir, 'core.ts');
fs.writeFileSync(mainFile, 'export const version = "1.0.0";\n', 'utf-8');
execSync('git add core.ts', { cwd: sandboxDir, stdio: 'ignore' });
execSync('git commit -m "initial commit"', { cwd: sandboxDir, stdio: 'ignore' });

// 2. Create Shadow Worktree
const taskId = 'task-shadow-001';
const shadowInfo = ShadowWorktree.createShadow(sandboxDir, taskId);
assert.ok(fs.existsSync(shadowInfo.shadowPath));
assert.strictEqual(shadowInfo.isGitWorktree, true);
console.log(`[PASS]: Git Shadow Worktree created successfully at: ${shadowInfo.shadowPath}`);

// 3. Modify file in Shadow Worktree and verify Main Workspace remains unaffected
const shadowCoreFile = path.join(shadowInfo.shadowPath, 'core.ts');
fs.writeFileSync(shadowCoreFile, 'export const version = "2.0.0-shadow";\n', 'utf-8');

const mainFileContentBefore = fs.readFileSync(mainFile, 'utf-8');
assert.strictEqual(mainFileContentBefore, 'export const version = "1.0.0";\n');
console.log('[PASS]: Absolute isolation: Changes in shadow DO NOT affect main workspace');

// 4. Promote verified files to Main Workspace
const promoted = ShadowWorktree.promoteToWorkspace(shadowInfo.shadowPath, sandboxDir, ['core.ts']);
assert.strictEqual(promoted.length, 1);
assert.strictEqual(promoted[0], 'core.ts');

const mainFileContentAfter = fs.readFileSync(mainFile, 'utf-8');
assert.strictEqual(mainFileContentAfter, 'export const version = "2.0.0-shadow";\n');
console.log('[PASS]: Promoted verified changes to main workspace successfully');

// 5. Clean up Shadow Worktree
const removed = ShadowWorktree.removeShadow(shadowInfo.shadowPath, sandboxDir);
assert.strictEqual(removed, true);
assert.strictEqual(fs.existsSync(shadowInfo.shadowPath), false);
console.log('[PASS]: Cleaned up and released Git Shadow Worktree successfully');

// Cleanup
try {
  fs.rmSync(sandboxDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
} catch {
  // Ignore Windows file locks on git directory
}

console.log('[SUCCESS]: ALL STEP 5 TESTS (GIT SHADOW WORKTREE SANDBOX) PASSED 100%!');
