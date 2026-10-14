import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface ReproducerResult {
  hasReproducer: boolean;
  filePath?: string;
  initialFailed?: boolean;
  postFixPassed?: boolean;
  evidence: string;
}

/**
 * ReproducerGate enforces the Princeton SWE-agent / AutoCodeRover protocol:
 * "Empirical proof: Reproduce the bug first with a minimal test, then fix and verify."
 */
export class ReproducerGate {
  /**
   * Evaluates if a test file reproduces a reported issue and passes post-fix
   */
  static runReproducerTest(cwd: string, testFilePath: string): { success: boolean; output: string } {
    const absPath = path.isAbsolute(testFilePath) ? testFilePath : path.join(cwd, testFilePath);
    if (!fs.existsSync(absPath)) {
      return { success: false, output: `Reproducer test file does not exist at: ${testFilePath}` };
    }

    try {
      let cmd = `npx tsx "${absPath}"`;
      if (testFilePath.endsWith('.py')) {
        cmd = `python "${absPath}"`;
      } else if (testFilePath.endsWith('.js') || testFilePath.endsWith('.mjs')) {
        cmd = `node "${absPath}"`;
      }

      const output = execSync(cmd, {
        cwd,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return { success: true, output: output.trim() };
    } catch (err: any) {
      const stderr = err.stderr ? String(err.stderr) : '';
      const stdout = err.stdout ? String(err.stdout) : '';
      return {
        success: false,
        output: `${stdout}\n${stderr}`.trim() || err.message || 'Test execution failed',
      };
    }
  }

  /**
   * Formulates the SWE reproducible verification directive for prompts
   */
  static getReproducerDirective(): string {
    return [
      '# Empirical Reproducer-First Protocol (SWE Standard)',
      '- When diagnosing an unexpected bug, failure, or logic error:',
      '  1. PROVE IT FIRST: Create a standalone reproduction test script (e.g. `repro_bug.ts` or temporary unit test).',
      '  2. CONFIRM FAILURE: Run the reproduction test to verify it fails as expected.',
      '  3. SURGICAL FIX: Apply the minimal correct change directly resolving the issue.',
      '  4. CONFIRM SUCCESS: Re-run the reproduction test to prove the bug is resolved.',
      '  5. CLEANUP: Remove temporary repro scripts before concluding the task.',
      '- NO EVIDENCE, NO DONE: Never declare a bug fixed without empirical command or test output.'
    ].join('\n');
  }
}
