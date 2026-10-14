import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SwarmCoordinator } from '../engine/swarm/SwarmCoordinator.js';
import type { SwarmProgressEvent } from '../engine/swarm/SwarmTypes.js';

const execFileAsync = promisify(execFile);

async function setupTempGitRepo(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-coord-test-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.name', 'InterShaderTest'], { cwd: tmpDir });
  await execFileAsync('git', ['config', 'user.email', 'test@intershader.org'], { cwd: tmpDir });
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test-repo"}\n', 'utf-8');
  await execFileAsync('git', ['add', '.'], { cwd: tmpDir });
  await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });
  return tmpDir;
}

async function testSwarmCoordinator() {
  console.log('--- Testing SwarmCoordinator Role Inference & Dispatching ---');

  // 1. Test Role & Scope Inference
  const backendInferred = SwarmCoordinator.inferRoleAndScope('viết api endpoint cho authentication');
  assert.strictEqual(backendInferred.role, 'backend');
  assert.ok(backendInferred.scope.includes('src/api/**'), 'Backend scope should include src/api/**');

  const frontendInferred = SwarmCoordinator.inferRoleAndScope('thiết kế UI LoginForm bằng React components');
  assert.strictEqual(frontendInferred.role, 'frontend');
  assert.ok(frontendInferred.scope.includes('src/ui/**'), 'Frontend scope should include src/ui/**');

  const testerInferred = SwarmCoordinator.inferRoleAndScope('viết unit test kiểm thử logic token');
  assert.strictEqual(testerInferred.role, 'tester');
  assert.ok(testerInferred.scope.includes('tests/**'), 'Tester scope should include tests/**');

  const architectInferred = SwarmCoordinator.inferRoleAndScope('thiết kế schema types và interface contracts');
  assert.strictEqual(architectInferred.role, 'architect');
  assert.ok(architectInferred.scope.includes('src/types/**'), 'Architect scope should include src/types/**');

  console.log('[PASS]: Role and scope inference verified accurately.');

  // 2. Test Coordinator Event Emission
  const coordinator = new SwarmCoordinator();
  let progressEventCount = 0;
  coordinator.on('progress', (event: SwarmProgressEvent) => {
    progressEventCount++;
    assert.ok(event.tasks.length >= 2, 'Progress event should contain tasks');
  });

  const tempRepo = await setupTempGitRepo();

  try {
    const prompts = [
      { prompt: 'Tạo file helper tính toán src/services/math.ts' },
      { prompt: 'Tạo component nút bấm src/ui/Button.tsx' },
    ];

    console.log('Launching 2 parallel swarm tasks...');
    const result = await coordinator.runParallel(prompts, tempRepo, false);

    assert.strictEqual(result.tasks.length, 2, 'Should spawn 2 worker tasks');
    assert.ok(progressEventCount >= 1, 'Should have emitted progress events');
    console.log('Coordinator spawned tasks:', result.tasks.map((t) => `${t.role} (${t.status})`).join(', '));

    console.log('All SwarmCoordinator tests passed successfully!');
  } finally {
    try {
      await coordinator.cancel(tempRepo);
      fs.rmSync(tempRepo, { recursive: true, force: true });
    } catch {}
  }
}

testSwarmCoordinator().catch((err) => {
  console.error('SwarmCoordinator test failed:', err);
  process.exit(1);
});
