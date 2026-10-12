import assert from 'node:assert';
import { BenchmarkHarness, type FixBenchmarkTask, type CleanBenchmarkTask } from '../engine/benchmark/BenchmarkHarness.js';

console.log('[TEST]: Starting Modular Benchmark Harness Suite...');

const harness = new BenchmarkHarness();

// Register 2 FixBenchmarkTasks
const fixTask1: FixBenchmarkTask = {
  taskId: 'FIX-TASK-001',
  category: 'RACE_CONDITION',
  name: 'Fix Async State Race Condition',
  defectDescription: 'Shared cache state modified concurrently without lock',
  expectedRepairType: 'Mutex Synchronization',
  execute: async () => {
    return BenchmarkHarness.createReferenceObservation({
      taskId: 'FIX-TASK-001',
      oracleSuccess: true,
      evaluatorSuccess: true,
      repaired: true,
      mutantsTotal: 10,
      mutantsKilled: 9,
      counterexamplesApplicable: 2,
      counterexamplesReproduced: 2,
      mutationFamilies: {
        relational: 90,
        logical: 95,
        controlFlow: 90,
        valueMutation: 85,
        returnMutation: 85,
        errorHandling: 90,
        asyncOp: 100,
        security: 90,
      },
    });
  },
};

const fixTask2: FixBenchmarkTask = {
  taskId: 'FIX-TASK-002',
  category: 'SECURITY_INJECTION',
  name: 'Fix Path Traversal Injection',
  defectDescription: 'File path input allows parent directory escape',
  expectedRepairType: 'Path Boundary Normalization',
  execute: async () => {
    return BenchmarkHarness.createReferenceObservation({
      taskId: 'FIX-TASK-002',
      oracleSuccess: true,
      evaluatorSuccess: true,
      repaired: true,
      mutantsTotal: 10,
      mutantsKilled: 10,
      counterexamplesApplicable: 1,
      counterexamplesReproduced: 1,
      mutationFamilies: {
        relational: 95,
        logical: 95,
        controlFlow: 95,
        valueMutation: 90,
        returnMutation: 90,
        errorHandling: 90,
        asyncOp: 85,
        security: 100,
      },
    });
  },
};

// Register 1 CleanBenchmarkTask (Tests clean codebase without defects - preserves code, no repair needed)
const cleanTask1: CleanBenchmarkTask = {
  taskId: 'CLEAN-TASK-001',
  name: 'Clean Codebase Invariant Preservation',
  cleanCodeDescription: 'Standard healthy TypeScript repository',
  execute: async () => {
    return BenchmarkHarness.createReferenceObservation({
      taskId: 'CLEAN-TASK-001',
      oracleSuccess: true,
      evaluatorSuccess: true,
      repaired: false,
      mutantsTotal: 10,
      mutantsKilled: 9,
      counterexamplesApplicable: 0,
      counterexamplesReproduced: 0,
      mutationFamilies: {
        relational: 90,
        logical: 90,
        controlFlow: 90,
        valueMutation: 85,
        returnMutation: 85,
        errorHandling: 90,
        asyncOp: 90,
        security: 90,
      },
    });
  },
};

harness.registerFixTask(fixTask1);
harness.registerFixTask(fixTask2);
harness.registerCleanTask(cleanTask1);

const results = await harness.runComprehensive();

assert.strictEqual(results.totalExecuted, 3);
assert.strictEqual(results.fixBenchmarkResults.totalTasks, 2);
assert.strictEqual(results.fixBenchmarkResults.repairTriggeredCount, 2);
assert.strictEqual(results.fixBenchmarkResults.repairSuccessRate, 100.0);
assert.strictEqual(results.fixBenchmarkResults.evidenceEscapeRate, 0.0);

assert.strictEqual(results.cleanBenchmarkResults.totalTasks, 1);
assert.strictEqual(results.cleanBenchmarkResults.firstPassSuccessRate, 100.0);
assert.strictEqual(results.cleanBenchmarkResults.repairTriggeredCount, 0);
assert.strictEqual(results.cleanBenchmarkResults.falsePositiveRate, 0.0);

assert.strictEqual(results.comprehensiveScorecard.totalTasks, 3);
assert.strictEqual(results.comprehensiveScorecard.evidenceEscapeRate, 0.0);
assert.strictEqual(results.comprehensiveScorecard.attestationIntegrity, 100.0);
assert.strictEqual(results.comprehensiveScorecard.evidenceConfidenceTier === 'HIGH' || results.comprehensiveScorecard.evidenceConfidenceTier === 'MEDIUM', true);

console.log('[PASS]: BenchmarkHarness executed both Fix and Clean benchmark suites cleanly.');
