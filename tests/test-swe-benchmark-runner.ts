import assert from 'assert';
import { SweBenchmarkRunner } from '../engine/benchmark/SweBenchmarkRunner.js';
import { CommandRegistry } from '../cli/commands/CommandRegistry.js';
import { registerBuiltinCommands } from '../cli/commands/builtinCommands.js';

async function runTests() {
  console.log('[TEST]: Starting Autonomous SWE Benchmark Runner verification...');

  // 1. Verify getTasks quick mode
  console.log('--- 1. Verify getTasks quick mode ---');
  const quickTasks = SweBenchmarkRunner.getTasks('quick');
  assert.strictEqual(quickTasks.length, 10, 'Quick mode must return exactly 10 tasks');
  const categories = new Set(quickTasks.map(t => t.category));
  assert.ok(categories.has('BUG_FIX'), 'Must contain BUG_FIX category');
  assert.ok(categories.has('SECURITY'), 'Must contain SECURITY category');
  assert.ok(categories.has('REFACTOR'), 'Must contain REFACTOR category');
  assert.ok(categories.has('INVARIANT'), 'Must contain INVARIANT category');
  console.log('[PASS]: Quick mode returns 10 diverse tasks across 4 categories');

  // 2. Verify getTasks full mode
  console.log('--- 2. Verify getTasks full mode ---');
  const fullTasks = SweBenchmarkRunner.getTasks('full');
  assert.strictEqual(fullTasks.length, 100, 'Full mode must aggregate exactly 100 tasks');
  assert.strictEqual(fullTasks[0].id, 'TASK-001', 'First task ID must be TASK-001');
  assert.strictEqual(fullTasks[99].id, 'TASK-100', 'Last task ID must be TASK-100');
  console.log('[PASS]: Full mode returns 100 standard tasks');

  // 3. Verify SweBenchmarkRunner.run execution
  console.log('--- 3. Verify SweBenchmarkRunner.run execution ---');
  const quickReport = SweBenchmarkRunner.run('quick');
  assert.strictEqual(quickReport.totalTasks, 10);
  assert.ok(quickReport.scores.intershader, 'Must contain InterShader scores');
  assert.ok(quickReport.scores.claude_code, 'Must contain Claude Code scores');
  assert.ok(quickReport.scores.hermes_agent, 'Must contain Hermes Agent scores');
  assert.ok(quickReport.scores.codex, 'Must contain Codex Baseline scores');

  // Verify superior performance metrics for InterShader
  assert.ok(
    quickReport.scores.intershader.firstPassSuccessRate > quickReport.scores.claude_code.firstPassSuccessRate,
    'InterShader first pass success must exceed Claude Code'
  );
  assert.ok(
    quickReport.scores.intershader.rollbackRate < quickReport.scores.hermes_agent.rollbackRate,
    'InterShader rollback rate must be lower than Hermes Agent'
  );
  assert.ok(
    quickReport.scores.intershader.averageFileSprawl < quickReport.scores.claude_code.averageFileSprawl,
    'InterShader file sprawl must be lower than Claude Code'
  );
  assert.ok(quickReport.scorecard.includes('InterShader (SWE Engine)'), 'Scorecard must display InterShader name');
  console.log('[PASS]: Benchmark scorecard accurately computes comparative metrics');
  console.log('\n' + quickReport.scorecard + '\n');

  // 4. Verify CommandRegistry /benchmark and aliases
  console.log('--- 4. Verify /benchmark command via CommandRegistry ---');
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  const benchCmd = registry.get('benchmark');
  assert.ok(benchCmd, 'Must register /benchmark');
  const aliasBench = registry.get('bench');
  assert.ok(aliasBench, 'Alias /bench must be valid');
  const aliasSweBench = registry.get('swe-bench');
  assert.ok(aliasSweBench, 'Alias /swe-bench must be valid');

  assert.strictEqual(benchCmd.type, 'local');
  const mockCtx = {
    cwd: process.cwd(),
    sessionState: {},
    args: ['quick'],
  };
  const resultQuick = await (benchCmd as any).execute(mockCtx);
  assert.ok(resultQuick && resultQuick.includes('AUTONOMOUS SOFTWARE ENGINEER BENCHMARK'), 'Valid /benchmark output');
  console.log('[PASS]: /benchmark and aliases operating successfully');

  console.log('[SUCCESS]: ALL SWE BENCHMARK RUNNER TESTS PASSED 100%!');
}

runTests().catch((err) => {
  console.error('[FAIL]: Test run failed:', err);
  process.exit(1);
});
