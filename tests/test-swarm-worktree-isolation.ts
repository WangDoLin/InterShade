import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OrcaWorktreeOrchestrator } from '../engine/orchestration/OrcaWorktreeOrchestrator.js';
import { SwarmIntegrator } from '../engine/swarm/SwarmIntegrator.js';
import type { SwarmTask } from '../engine/swarm/SwarmTypes.js';

const execFileAsync = promisify(execFile);

async function setupTempGitRepo(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-wt-test-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'InterShaderTest'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@intershader.org'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Swarm Repo\n', 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });
  return tmpDir;
}

async function testSwarmWorktreeIsolation() {
  console.log('--- Testing Swarm Worktree Isolation & Zero-Conflict Integration ---');
  const tempRepo = await setupTempGitRepo();

  try {
    // 1. Create two isolated worktrees for two parallel worker agents
    const wt1 = await OrcaWorktreeOrchestrator.createWorktree('worker-backend-001', 'HEAD', tempRepo);
    const wt2 = await OrcaWorktreeOrchestrator.createWorktree('worker-frontend-002', 'HEAD', tempRepo);

    assert.ok(fs.existsSync(wt1.worktreePath), 'Worktree 1 directory should exist');
    assert.ok(fs.existsSync(wt2.worktreePath), 'Worktree 2 directory should exist');

    // 2. Worker 1 modifies backend file in wt1
    const backendFile = path.join(wt1.worktreePath, 'authService.ts');
    fs.writeFileSync(backendFile, 'export function login() { return true; }\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: wt1.worktreePath });
    await execFileAsync('git', ['commit', '-m', 'feat: add auth service'], { cwd: wt1.worktreePath });

    // 3. Worker 2 modifies frontend file in wt2
    const frontendFile = path.join(wt2.worktreePath, 'LoginForm.tsx');
    fs.writeFileSync(frontendFile, 'export function LoginForm() { return "<form>"; }\n', 'utf-8');
    await execFileAsync('git', ['add', '.'], { cwd: wt2.worktreePath });
    await execFileAsync('git', ['commit', '-m', 'feat: add login form'], { cwd: wt2.worktreePath });

    // Construct completed SwarmTask items
    const task1: SwarmTask = {
      id: 'worker-backend-001',
      role: 'backend',
      prompt: 'Implement authService',
      status: 'completed',
      progressPercent: 100,
      worktreePath: wt1.worktreePath,
      branch: wt1.branch,
      leasedFiles: ['authService.ts'],
    };

    const task2: SwarmTask = {
      id: 'worker-frontend-002',
      role: 'frontend',
      prompt: 'Implement LoginForm',
      status: 'completed',
      progressPercent: 100,
      worktreePath: wt2.worktreePath,
      branch: wt2.branch,
      leasedFiles: ['LoginForm.tsx'],
    };

    // 4. SwarmIntegrator cleanly merges both worktrees without conflict!
    const mergeResult = await SwarmIntegrator.mergeSwarmTasks([task1, task2], 'HEAD', tempRepo);
    console.log('Merge Result message:', mergeResult.message);
    assert.strictEqual(mergeResult.success, true, 'Merge should succeed cleanly');
    assert.strictEqual(mergeResult.mergedBranches.length, 2, 'Both branches should be merged');

    // Verify files exist in main repo
    assert.ok(fs.existsSync(path.join(tempRepo, 'authService.ts')), 'authService.ts should now exist in main workspace');
    assert.ok(fs.existsSync(path.join(tempRepo, 'LoginForm.tsx')), 'LoginForm.tsx should now exist in main workspace');

    console.log('All Swarm Worktree Isolation & Integration tests passed successfully!');
  } finally {
    try {
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {}
  }
}

testSwarmWorktreeIsolation().catch((err) => {
  console.error('Worktree Isolation test failed:', err);
  process.exit(1);
});
