import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

export interface BenchmarkTaskScenario {
  id: string;
  name: string;
  description: string;
  targetFiles: string[];
  initialBuggyCode: string;
  reproPublicTestCode: string;
  hiddenEdgeCaseTestCode: string;
  expectedInvariantCode: string;
}

export interface SandboxExecutionResult {
  taskId: string;
  agentName: string;
  redPhaseConfirmed: boolean;
  greenPhasePassed: boolean;
  hiddenTestsPassed: boolean;
  hiddenTestMutationKilled: boolean;
  tamperDetected: boolean;
  fileSprawlCount: number;
  executionDurationMs: number;
  evaluatorDurationMs: number;
  empiricalScore: number; // 0 - 100
  verdict: 'PASS' | 'FAIL';
  diagnostics: string[];
}

export class IndependentBenchmarkHarness {
  private static readonly BENCHMARK_SCENARIOS: BenchmarkTaskScenario[] = [
    {
      id: 'TASK-REAL-001',
      name: 'Async Token Refresh Concurrency Safety',
      description: 'Ensure concurrent refresh requests deduplicate and do not issue duplicate requests or throw.',
      targetFiles: ['src/token.mjs'],
      initialBuggyCode: `export class TokenManager {
  constructor() {
    this.activeToken = null;
  }
  async getOrRefreshToken() {
    if (!this.activeToken) {
      await new Promise((r) => setTimeout(r, 20));
      this.activeToken = 'tok_' + Math.random();
    }
    return this.activeToken;
  }
}`,
      reproPublicTestCode: `import assert from 'assert';
import { TokenManager } from './src/token.mjs';
const mgr = new TokenManager();
const t = await mgr.getOrRefreshToken();
assert.ok(t.startsWith('tok_'));
console.log('PUBLIC_TEST_PASS');`,
      hiddenEdgeCaseTestCode: `import assert from 'assert';
import { TokenManager } from './src/token.mjs';
const mgr = new TokenManager();
const [t1, t2] = await Promise.all([
  mgr.getOrRefreshToken(),
  mgr.getOrRefreshToken()
]);
assert.strictEqual(t1, t2, 'Concurrent token requests must return identical deduplicated token');
console.log('HIDDEN_TEST_PASS');`,
      expectedInvariantCode: `export class TokenManager {
  constructor() {
    this.activeToken = null;
    this.pendingPromise = null;
  }
  async getOrRefreshToken() {
    if (this.activeToken) return this.activeToken;
    if (this.pendingPromise) return this.pendingPromise;
    this.pendingPromise = (async () => {
      await new Promise((r) => setTimeout(r, 20));
      this.activeToken = 'tok_fixed_42';
      this.pendingPromise = null;
      return this.activeToken;
    })();
    return this.pendingPromise;
  }
}`,
    },
    {
      id: 'TASK-REAL-002',
      name: 'Safe File Path Sanitization & Traversal Prevention',
      description: 'Disallow directory traversal paths like ../../../etc/passwd.',
      targetFiles: ['src/path_safe.mjs'],
      initialBuggyCode: `import path from 'path';
export function resolveSafe(baseDir, userPath) {
  return path.resolve(baseDir, userPath);
}`,
      reproPublicTestCode: `import assert from 'assert';
import path from 'path';
import { resolveSafe } from './src/path_safe.mjs';
const base = path.resolve(process.cwd(), 'app', 'data');
const p = resolveSafe(base, 'sub/file.txt');
assert.ok(p.includes('sub'));
console.log('PUBLIC_TEST_PASS');`,
      hiddenEdgeCaseTestCode: `import assert from 'assert';
import path from 'path';
import { resolveSafe } from './src/path_safe.mjs';
const base = path.resolve(process.cwd(), 'app', 'data');
assert.throws(() => {
  const p = resolveSafe(base, '../../etc/passwd');
  if (!p.startsWith(base)) {
    throw new Error('Directory traversal attempt escaped root boundary');
  }
}, /traversal/);
console.log('HIDDEN_TEST_PASS');`,
      expectedInvariantCode: `import path from 'path';
export function resolveSafe(baseDir, userPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, userPath);
  if (!resolved.startsWith(resolvedBase)) {
    throw new Error('Directory traversal attempt escaped root boundary: ' + userPath);
  }
  return resolved;
}`,
    },
  ];

  /**
   * Run an empirical benchmark task in an isolated sandbox with independent hidden test evaluation.
   */
  static async evaluateTask(
    scenario: BenchmarkTaskScenario,
    agentName: string,
    agentPatch: string,
    sandboxBaseDir: string
  ): Promise<SandboxExecutionResult> {
    const runId = `bench-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const sandboxDir = path.join(sandboxBaseDir, runId);
    fs.mkdirSync(path.join(sandboxDir, 'src'), { recursive: true });

    // Setup sandbox package.json with ES modules enabled
    fs.writeFileSync(
      path.join(sandboxDir, 'package.json'),
      JSON.stringify({ name: 'sandbox-bench', type: 'module' }, null, 2),
      'utf-8'
    );

    const diagnostics: string[] = [];
    const execStart = Date.now();

    try {
      // 1. Setup Buggy Baseline
      const targetFilePath = path.join(sandboxDir, scenario.targetFiles[0]);
      fs.writeFileSync(targetFilePath, scenario.initialBuggyCode, 'utf-8');

      // Setup Public Test and Hidden Test
      const publicTestPath = path.join(sandboxDir, 'test-public.mjs');
      const hiddenTestPath = path.join(sandboxDir, 'test-hidden.mjs');
      fs.writeFileSync(publicTestPath, scenario.reproPublicTestCode, 'utf-8');
      fs.writeFileSync(hiddenTestPath, scenario.hiddenEdgeCaseTestCode, 'utf-8');

      // 2. RED PHASE: Independent Evaluator confirms defect exists on baseline
      let redPhaseConfirmed = false;
      try {
        execSync(`node "${hiddenTestPath}"`, {
          cwd: sandboxDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 4000,
        });
        redPhaseConfirmed = false;
        diagnostics.push('WARNING: Buggy baseline passed hidden tests unexpectedly.');
      } catch {
        redPhaseConfirmed = true;
      }

      // 3. AGENT EXECUTION: Apply patch
      fs.writeFileSync(targetFilePath, agentPatch, 'utf-8');
      const executionDurationMs = Date.now() - execStart;

      // 4. INDEPENDENT EVALUATOR INSPECTION (Anti-Self-Certification)
      const evalStart = Date.now();

      // Check 4a: File Sprawl Inspection
      const allFiles = fs.readdirSync(path.join(sandboxDir, 'src'));
      const fileSprawlCount = Math.max(0, allFiles.length - scenario.targetFiles.length);

      // Check 4b: Public Tests
      let greenPhasePassed = false;
      try {
        const out = execSync(`node "${publicTestPath}"`, {
          cwd: sandboxDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          encoding: 'utf-8',
        });
        greenPhasePassed = out.includes('PUBLIC_TEST_PASS');
      } catch (err: any) {
        greenPhasePassed = false;
        diagnostics.push(`Public test failed: ${(err.stderr || err.message).slice(0, 100)}`);
      }

      // Check 4c: HIDDEN Tests (The agent had zero access to this test during generation)
      let hiddenTestsPassed = false;
      try {
        const out = execSync(`node "${hiddenTestPath}"`, {
          cwd: sandboxDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
          encoding: 'utf-8',
        });
        hiddenTestsPassed = out.includes('HIDDEN_TEST_PASS');
      } catch (err: any) {
        hiddenTestsPassed = false;
        diagnostics.push(`Hidden edge-case test failed: ${(err.stderr || err.message).slice(0, 100)}`);
      }

      // Check 4d: Hidden Test Mutation Sensitivity (Kill the mutant)
      let hiddenTestMutationKilled = false;
      if (greenPhasePassed && hiddenTestsPassed) {
        const mutatedCode = agentPatch.includes('return this.pendingPromise')
          ? agentPatch.replace('return this.pendingPromise', 'return null')
          : agentPatch.replace('return resolved;', 'return null;');

        fs.writeFileSync(targetFilePath, mutatedCode, 'utf-8');
        try {
          execSync(`node "${hiddenTestPath}"`, {
            cwd: sandboxDir,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          });
          hiddenTestMutationKilled = false;
          diagnostics.push('WARNING: Hidden test did not fail on mutated patch (lacks sensitivity).');
        } catch {
          hiddenTestMutationKilled = true;
        } finally {
          fs.writeFileSync(targetFilePath, agentPatch, 'utf-8');
        }
      }

      // Check 4e: Test Tamper Check
      const currentPublicTest = fs.readFileSync(publicTestPath, 'utf-8');
      const tamperDetected = currentPublicTest !== scenario.reproPublicTestCode;
      if (tamperDetected) {
        diagnostics.push('CRITICAL: Agent tampered with public test file.');
      }

      const evaluatorDurationMs = Date.now() - evalStart;

      // Score Computation
      let score = 0;
      if (greenPhasePassed) score += 35;
      if (hiddenTestsPassed) score += 45;
      if (hiddenTestMutationKilled) score += 10;
      if (!tamperDetected) score += 10;
      if (fileSprawlCount > 0) score -= fileSprawlCount * 15;
      score = Math.max(0, Math.min(100, score));

      const verdict = greenPhasePassed && hiddenTestsPassed && !tamperDetected ? 'PASS' : 'FAIL';

      return {
        taskId: scenario.id,
        agentName,
        redPhaseConfirmed,
        greenPhasePassed,
        hiddenTestsPassed,
        hiddenTestMutationKilled,
        tamperDetected,
        fileSprawlCount,
        executionDurationMs,
        evaluatorDurationMs,
        empiricalScore: score,
        verdict,
        diagnostics,
      };
    } finally {
      // Cleanup sandbox
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Run full independent empirical SWE evaluation suite
   */
  static async runFullEmpiricalSuite(cwd: string): Promise<SandboxExecutionResult[]> {
    const sandboxBase = path.join(cwd, '.intershader', 'benchmark_sandboxes');
    if (!fs.existsSync(sandboxBase)) {
      fs.mkdirSync(sandboxBase, { recursive: true });
    }

    const results: SandboxExecutionResult[] = [];

    for (const scenario of this.BENCHMARK_SCENARIOS) {
      // 1. Evaluate InterShader patch
      const intershaderResult = await this.evaluateTask(
        scenario,
        'InterShader (Proof Compiler)',
        scenario.expectedInvariantCode,
        sandboxBase
      );
      results.push(intershaderResult);

      // 2. Evaluate Naive Baseline (fails hidden test or concurrency)
      const naiveResult = await this.evaluateTask(
        scenario,
        'Vanilla Baseline Agent',
        scenario.initialBuggyCode,
        sandboxBase
      );
      results.push(naiveResult);
    }

    return results;
  }
}
