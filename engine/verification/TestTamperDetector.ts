import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface TamperReport {
  isTampered: boolean;
  tamperedFiles: string[];
  reasons: string[];
  baselineHashes: Record<string, string>;
  currentHashes: Record<string, string>;
}

export class TestTamperDetector {
  private static readonly TEST_DIR_CANDIDATES = ['tests', 'test', '__tests__', 'spec'];
  private static readonly TAMPER_PATTERNS = [
    { pattern: /\.skip\s*\(/, reason: 'Test suite assertion bypassed using .skip()' },
    { pattern: /\.only\s*\(/, reason: 'Test isolation detected using .only() hiding regressions' },
    { pattern: /\bxit\s*\(/, reason: 'Disabled test detected using xit()' },
    { pattern: /\bxdescribe\s*\(/, reason: 'Disabled test suite detected using xdescribe()' },
    { pattern: /expect\s*\(\s*(true|1)\s*\)\.to(Be|Equal)\s*\(\s*(true|1)\s*\)/, reason: 'Tautological dummy assertion replacing real verification' },
    { pattern: /assert\s*\(\s*true\s*\)/, reason: 'Tautological assert(true) detected' },
  ];

  /**
   * Calculate SHA-256 hash of a file
   */
  private static hashFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Discover all test files in project workspace
   */
  static discoverTestFiles(cwd: string): string[] {
    const testFiles: string[] = [];

    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (
          entry.isFile() &&
          (/\.(test|spec)\.[jt]sx?$/.test(entry.name) || entry.name.startsWith('test-'))
        ) {
          testFiles.push(path.relative(cwd, full).replace(/\\/g, '/'));
        }
      }
    };

    for (const d of this.TEST_DIR_CANDIDATES) {
      walk(path.join(cwd, d));
    }

    return testFiles;
  }

  /**
   * Capture cryptographic baseline snapshot of test files before agent modification
   */
  static snapshotBaseline(cwd: string): Record<string, string> {
    const files = this.discoverTestFiles(cwd);
    const map: Record<string, string> = {};
    for (const rel of files) {
      const full = path.resolve(cwd, rel);
      if (fs.existsSync(full)) {
        try {
          map[rel] = this.hashFile(full);
        } catch {
          // ignore
        }
      }
    }
    return map;
  }

  /**
   * Audit modified files against baseline snapshot and inspect for assertions weakening
   */
  static audit(
    cwd: string,
    modifiedFiles: string[],
    allowedFiles: string[] = [],
    baseline: Record<string, string> = {}
  ): TamperReport {
    const tamperedFiles: string[] = [];
    const reasons: string[] = [];
    const currentHashes: Record<string, string> = {};

    const allTestFiles = this.discoverTestFiles(cwd);

    for (const rel of allTestFiles) {
      const full = path.resolve(cwd, rel);
      if (fs.existsSync(full)) {
        try {
          currentHashes[rel] = this.hashFile(full);
        } catch {
          // ignore
        }
      }
    }

    // Check 1: Unexpected test modifications not explicitly in allowedFiles
    for (const rel of modifiedFiles) {
      const isTestFile = allTestFiles.includes(rel) || /\.(test|spec)\.[jt]sx?$/.test(rel) || rel.includes('test-');
      if (isTestFile && !allowedFiles.includes(rel)) {
        tamperedFiles.push(rel);
        reasons.push(`Test file "${rel}" was modified without authorization outside allowedFiles scope.`);
      }
    }

    // Check 2: Hash mismatch vs baseline for test files
    for (const [testFile, baseHash] of Object.entries(baseline)) {
      const currHash = currentHashes[testFile];
      if (currHash && currHash !== baseHash && !allowedFiles.includes(testFile)) {
        if (!tamperedFiles.includes(testFile)) {
          tamperedFiles.push(testFile);
          reasons.push(`Cryptographic digest mismatch in test file "${testFile}" (baseline: ${baseHash.slice(0, 8)}, current: ${currHash.slice(0, 8)}).`);
        }
      }
    }

    // Check 3: Assertion weakening & bypass patterns
    for (const testFile of modifiedFiles) {
      if (allTestFiles.includes(testFile) || testFile.includes('test')) {
        const full = path.resolve(cwd, testFile);
        if (fs.existsSync(full)) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            for (const { pattern, reason } of this.TAMPER_PATTERNS) {
              if (pattern.test(content)) {
                tamperedFiles.push(testFile);
                reasons.push(`Tamper pattern detected in "${testFile}": ${reason}`);
                break;
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return {
      isTampered: tamperedFiles.length > 0,
      tamperedFiles: Array.from(new Set(tamperedFiles)),
      reasons,
      baselineHashes: baseline,
      currentHashes,
    };
  }
}
