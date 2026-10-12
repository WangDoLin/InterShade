import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface VerificationResult {
  passed: boolean;
  checkType: 'ast' | 'typecheck' | 'test' | 'linter';
  errorDetails?: string;
  diagnostics?: Array<{ file: string; line?: number; message: string }>;
}

/**
 * VerificationGate enforces evidence-based task completion.
 * Verifies code syntax and tests before declaring tasks done.
 */
export class VerificationGate {
  /**
   * Run syntax and TypeScript compile check in the workspace
   */
  static verifyTypeScript(cwd: string): VerificationResult {
    const tsconfigPath = path.join(cwd, 'tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      return { passed: true, checkType: 'typecheck' };
    }

    try {
      execSync('npx tsc --noEmit', {
        cwd,
        encoding: 'utf-8',
        timeout: 20000,
        stdio: 'pipe',
      });
      return { passed: true, checkType: 'typecheck' };
    } catch (err: unknown) {
      const errorOutput = (err as { stdout?: string; stderr?: string }).stdout || '';
      const diagnostics = this.parseTscErrors(errorOutput);

      return {
        passed: false,
        checkType: 'typecheck',
        errorDetails: errorOutput.slice(0, 1000),
        diagnostics,
      };
    }
  }

  /**
   * Run project test suite if package.json has a test script
   */
  static verifyTests(cwd: string): VerificationResult {
    const pkgPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return {
        passed: false,
        checkType: 'test',
        errorDetails: 'NO_TEST_EVIDENCE: package.json not found in workspace. Verification requires verifiable test evidence.',
      };
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (!pkg.scripts?.test || pkg.scripts.test.includes('no test specified')) {
        return {
          passed: false,
          checkType: 'test',
          errorDetails: 'NO_TEST_EVIDENCE: No automated test suite configured in package.json. Policy requires real test evidence.',
        };
      }

      const output = execSync('npm test', {
        cwd,
        encoding: 'utf-8',
        timeout: 45000,
        stdio: 'pipe',
      });

      const cleanOut = (output || '').trim();
      if (cleanOut.length === 0) {
        return {
          passed: false,
          checkType: 'test',
          errorDetails: 'NO_EVALUATION: Test command exited with code 0 but produced zero test execution output.',
        };
      }

      return { passed: true, checkType: 'test' };
    } catch (err: unknown) {
      const output = (err as { stdout?: string; stderr?: string }).stdout || '';
      return {
        passed: false,
        checkType: 'test',
        errorDetails: output.slice(0, 1000),
      };
    }
  }

  private static parseTscErrors(output: string): Array<{ file: string; line?: number; message: string }> {
    const lines = output.split('\n');
    const errors: Array<{ file: string; line?: number; message: string }> = [];

    const regex = /^(.+)\((\d+),\d+\):\s+(error\s+TS\d+:\s+.+)$/;

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          message: match[3].trim(),
        });
      }
    }

    return errors.slice(0, 5);
  }
}
