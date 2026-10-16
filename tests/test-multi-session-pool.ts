import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MultiSessionPool } from '../engine/swarm/MultiSessionPool.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { FileLockRegistry } from '../engine/swarm/FileLockRegistry.js';

const execFileAsync = promisify(execFile);

async function setupTempGitRepo(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-test-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'InterShaderTest'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@intershader.org'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0' }, null, 2), 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
  await execFileAsync('git', ['commit', '-m', 'chore: initial commit'], { cwd: tmpDir });
  return tmpDir;
}

async function testMultiSessionPool() {
  console.log('--- Testing MultiSessionPool (Isolated Multi-Agent Concurrency) ---');

  const tempRepo = await setupTempGitRepo();
  MultiSessionPool.resetInstance();
  FileLockRegistry.clearAll();

  const pool = MultiSessionPool.getInstance();

  // 1. Initialize Primary Tab (Main Workspace)
  const primaryEngine = new QueryEngine({
    cwd: tempRepo,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    permissionMode: 'default',
    maxTokens: 8192,
  });

  const tab1 = pool.initPrimary(primaryEngine, 'Main Workspace');
  assert.strictEqual(tab1.isPrimary, true, 'Tab 1 should be primary');
  assert.strictEqual(tab1.title, 'Main Workspace', 'Tab 1 title should match');
  assert.strictEqual(tab1.worktreePath, tempRepo, 'Tab 1 worktreePath should match tempRepo');
  assert.strictEqual(pool.getTabs().length, 1, 'Should have exactly 1 tab');
  assert.strictEqual(pool.getActiveTab().id, tab1.id, 'Active tab should be primary tab');

  // Idempotency check: calling initPrimary again should return existing tab
  const tab1Again = pool.initPrimary(primaryEngine);
  assert.strictEqual(tab1Again.id, tab1.id, 'initPrimary should be idempotent');

  // 2. Create Secondary Tab (Backend Worker with isolated worktree)
  let tabCreatedEventReceived = false;
  pool.once('tab_created', (t) => {
    tabCreatedEventReceived = true;
    assert.strictEqual(t.title, 'Backend API', 'tab_created title should match');
  });

  const tab2 = await pool.createTab({
    title: 'Backend API',
    role: 'backend',
    scope: ['src/services/**', 'src/api/**'],
  });

  assert.strictEqual(tabCreatedEventReceived, true, 'Should emit tab_created event');
  assert.strictEqual(tab2.isPrimary, false, 'Tab 2 should not be primary');
  assert.strictEqual(tab2.role, 'backend', 'Tab 2 role should be backend');
  assert.ok(fs.existsSync(tab2.worktreePath), 'Tab 2 worktree path should exist on disk');
  assert.notStrictEqual(tab2.worktreePath, tempRepo, 'Tab 2 worktree must be isolated from main repo');
  assert.ok(tab2.branch?.startsWith('intershade-wt-'), 'Tab 2 should have dedicated worktree branch');
  assert.strictEqual(pool.getTabs().length, 2, 'Should now have 2 tabs in pool');

  // 3. Verify FileLockRegistry scope was registered for tab 2
  const inScopeLease = FileLockRegistry.acquireLease(
    path.join(tab2.worktreePath, 'src/api/auth.ts'),
    tab2.id,
    'backend'
  );
  assert.strictEqual(inScopeLease.acquired, true, 'Tab 2 should acquire lease on in-scope file');

  const outOfScopeLease = FileLockRegistry.acquireLease(
    path.join(tab2.worktreePath, 'src/ui/App.tsx'),
    tab2.id,
    'backend'
  );
  assert.strictEqual(outOfScopeLease.acquired, false, 'Tab 2 must be rejected for out-of-scope file');
  FileLockRegistry.releaseLease(path.join(tab2.worktreePath, 'src/api/auth.ts'), tab2.id);

  // 4. Background Progress Tracking & Unread Counts
  // Tab 1 is currently active. When Tab 2 engine emits progress, Tab 2 unread count increases.
  assert.strictEqual(tab2.unreadOutputs, 0, 'Tab 2 initially has 0 unread outputs');

  tab2.queryEngine.emit('tool_start', 'file_search');
  assert.strictEqual(tab2.status, 'running', 'Tab 2 status should be running');

  tab2.queryEngine.emit('tool_done', 'file_search');
  assert.strictEqual(tab2.unreadOutputs, 1, 'Tab 2 unreadOutputs should increment when not active');

  tab2.queryEngine.emit('done');
  assert.strictEqual(tab2.status, 'idle', 'Tab 2 status should return to idle');
  assert.strictEqual(tab2.unreadOutputs, 2, 'Tab 2 unreadOutputs should increment on done');

  // 5. Switching Tabs
  let tabSwitchedEventReceived = false;
  pool.once('tab_switched', (switched) => {
    tabSwitchedEventReceived = true;
    assert.strictEqual(switched.id, tab2.id, 'tab_switched event payload should be tab 2');
  });

  const switchedTab = pool.switchActiveTab(2); // 1-based index
  assert.strictEqual(tabSwitchedEventReceived, true, 'Should emit tab_switched event');
  assert.strictEqual(switchedTab.id, tab2.id, 'Active tab should now be tab 2');
  assert.strictEqual(pool.getActiveTab().id, tab2.id, 'pool.getActiveTab() should be tab 2');
  assert.strictEqual(tab2.unreadOutputs, 0, 'Switching to tab 2 should clear unread outputs');

  // 6. Secondary Tab Merge Verification
  // Make a commit in Tab 2 worktree
  const testFile = path.join(tab2.worktreePath, 'api.ts');
  fs.writeFileSync(testFile, 'export const api = "ready";\n', 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tab2.worktreePath });
  await execFileAsync('git', ['commit', '-m', 'feat: add api export'], { cwd: tab2.worktreePath });

  const mergeResult = await pool.mergeTab(tab2.id);
  assert.strictEqual(mergeResult.success, true, `Merge should succeed: ${mergeResult.message}`);
  assert.ok(fs.existsSync(path.join(tempRepo, 'api.ts')), 'Merged file should now exist in primary repo');

  // 7. Closing Tabs
  // Primary tab cannot be closed
  assert.rejects(
    async () => {
      await pool.closeTab(tab1.id);
    },
    /Primary workspace session \(Tab 1\) cannot be closed/,
    'Attempting to close primary tab should throw error'
  );

  // Close Tab 2: should cleanup worktree and return active tab to Tab 1
  let tabClosedEventReceived = false;
  pool.once('tab_closed', (closedId) => {
    tabClosedEventReceived = true;
    assert.strictEqual(closedId, tab2.id, 'tab_closed event payload should match tab2 id');
  });

  const closed = await pool.closeTab(tab2.id);
  assert.strictEqual(closed, true, 'closeTab should return true');
  assert.strictEqual(tabClosedEventReceived, true, 'Should emit tab_closed event');
  assert.strictEqual(pool.getTabs().length, 1, 'Only primary tab should remain');
  assert.strictEqual(pool.getActiveTab().id, tab1.id, 'Active tab should fall back to primary tab');

  // Verify Tab 2 worktree was removed from disk
  assert.strictEqual(fs.existsSync(tab2.worktreePath), false, 'Worktree directory should be deleted after close');

  // 8. Cleanup test environment
  pool.clearAll();
  try {
    fs.rmSync(tempRepo, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors on temp
  }

  console.log('All MultiSessionPool concurrency tests passed successfully!');
}

testMultiSessionPool().catch((err) => {
  console.error('MultiSessionPool Test Failed:', err);
  process.exit(1);
});
