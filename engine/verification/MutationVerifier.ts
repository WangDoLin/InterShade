import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export type MutationOperatorFamily =
  | 'RELATIONAL'
  | 'LOGICAL'
  | 'CONTROL_FLOW'
  | 'VALUE'
  | 'RETURN'
  | 'ERROR_HANDLING'
  | 'ASYNC'
  | 'SECURITY';

export interface MutationCandidate {
  family: MutationOperatorFamily;
  description: string;
  originalSnippet: string;
  mutatedSnippet: string;
  mutatedCode: string;
}

export interface MutationResult {
  file: string;
  family: MutationOperatorFamily;
  mutationDescription: string;
  originalSnippet: string;
  mutatedSnippet: string;
  mutantKilled: boolean;
  testOutputSummary: string;
}

export interface MutationReport {
  mutantsTested: number;
  mutantsKilled: number;
  mutantsSurvived: number;
  adequacyScore: number; // 0 - 100% (Mutation Score)
  isAdequate: boolean;
  operatorFamiliesCovered: MutationOperatorFamily[];
  findings: string[];
  results: MutationResult[];
}

export interface MutationOptions {
  cwd: string;
  testCommand?: string;
  maxMutants?: number;
  timeoutMs?: number;
}

export class MutationVerifier {
  /**
   * Comprehensive 8-Family Mutation Verification Engine
   * Validates that tests actively detect bugs when code is systematically broken.
   */
  static async verify(
    modifiedFiles: string[],
    options: MutationOptions
  ): Promise<MutationReport> {
    const cwd = options.cwd;
    const testCmd = options.testCommand || 'npm test';
    const maxMutants = options.maxMutants || 8;
    const timeoutMs = options.timeoutMs || 25000;

    const results: MutationResult[] = [];
    const findings: string[] = [];
    const familiesUsed = new Set<MutationOperatorFamily>();

    const prodFiles = modifiedFiles.filter(
      (f) =>
        (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs')) &&
        !f.includes('test') &&
        !f.includes('.spec.') &&
        !f.includes('dist/')
    );

    let mutantsAttempted = 0;

    for (const relFile of prodFiles) {
      if (mutantsAttempted >= maxMutants) break;
      const fullPath = path.resolve(cwd, relFile);
      if (!fs.existsSync(fullPath)) continue;

      const originalCode = fs.readFileSync(fullPath, 'utf-8');
      const mutationCandidates = this.generateMutations(originalCode);

      for (const mut of mutationCandidates) {
        if (mutantsAttempted >= maxMutants) break;
        mutantsAttempted++;
        familiesUsed.add(mut.family);

        try {
          // 1. Apply mutation
          fs.writeFileSync(fullPath, mut.mutatedCode, 'utf-8');

          // 2. Run test suite against mutant
          let mutantKilled = false;
          let testOutput = '';

          try {
            execSync(testCmd, {
              cwd,
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: timeoutMs,
              encoding: 'utf-8',
            });
            // If test passes without error, the mutant SURVIVED
            mutantKilled = false;
            testOutput = 'Test passed unexpectedly despite injected defect.';
          } catch (err: any) {
            // If test fails, mutant was KILLED
            mutantKilled = true;
            testOutput = (err.stdout || err.stderr || err.message || '').slice(0, 150).trim();
          }

          results.push({
            file: relFile,
            family: mut.family,
            mutationDescription: mut.description,
            originalSnippet: mut.originalSnippet,
            mutatedSnippet: mut.mutatedSnippet,
            mutantKilled,
            testOutputSummary: testOutput,
          });

          if (!mutantKilled) {
            findings.push(
              `WARNING: Mutant survived in ${relFile} [${mut.family}] (${mut.description}). Test suite does not protect this behavior.`
            );
          }
        } finally {
          // Restore exact original code
          fs.writeFileSync(fullPath, originalCode, 'utf-8');
        }
      }
    }

    const mutantsTested = results.length;
    const mutantsKilled = results.filter((r) => r.mutantKilled).length;
    const mutantsSurvived = mutantsTested - mutantsKilled;
    const adequacyScore = mutantsTested > 0 ? Math.round((mutantsKilled / mutantsTested) * 100) : 100;
    const isAdequate = mutantsSurvived === 0;

    return {
      mutantsTested,
      mutantsKilled,
      mutantsSurvived,
      adequacyScore,
      isAdequate,
      operatorFamiliesCovered: Array.from(familiesUsed),
      findings,
      results,
    };
  }

  /**
   * Systematically generate mutants across 8 operator families
   */
  static generateMutations(code: string): MutationCandidate[] {
    const list: MutationCandidate[] = [];

    // Family 1: RELATIONAL
    if (code.includes(' === ')) {
      list.push({
        family: 'RELATIONAL',
        description: 'Invert equality operator (=== to !==)',
        originalSnippet: ' === ',
        mutatedSnippet: ' !== ',
        mutatedCode: code.replace(' === ', ' !== '),
      });
    }
    if (code.includes(' > ') && !code.includes('=>')) {
      list.push({
        family: 'RELATIONAL',
        description: 'Invert greater-than operator (> to <=)',
        originalSnippet: ' > ',
        mutatedSnippet: ' <= ',
        mutatedCode: code.replace(' > ', ' <= '),
      });
    }

    // Family 2: LOGICAL
    if (code.includes(' && ')) {
      list.push({
        family: 'LOGICAL',
        description: 'Swap logical AND for OR (&& to ||)',
        originalSnippet: ' && ',
        mutatedSnippet: ' || ',
        mutatedCode: code.replace(' && ', ' || '),
      });
    }
    if (code.includes(' || ')) {
      list.push({
        family: 'LOGICAL',
        description: 'Swap logical OR for AND (|| to &&)',
        originalSnippet: ' || ',
        mutatedSnippet: ' && ',
        mutatedCode: code.replace(' || ', ' && '),
      });
    }

    // Family 3: CONTROL_FLOW
    if (code.includes('if (!') || code.includes('if (')) {
      if (code.includes('if (!')) {
        list.push({
          family: 'CONTROL_FLOW',
          description: 'Negate control flow condition (if (!x) to if (x))',
          originalSnippet: 'if (!',
          mutatedSnippet: 'if (',
          mutatedCode: code.replace('if (!', 'if ('),
        });
      }
    }

    // Family 4: VALUE
    if (code.includes('true') && !code.includes('return true;')) {
      list.push({
        family: 'VALUE',
        description: 'Invert boolean literal (true to false)',
        originalSnippet: 'true',
        mutatedSnippet: 'false',
        mutatedCode: code.replace(/\btrue\b/, 'false'),
      });
    }

    // Family 5: RETURN
    if (code.includes('return true;')) {
      list.push({
        family: 'RETURN',
        description: 'Invert return value (return true to return false)',
        originalSnippet: 'return true;',
        mutatedSnippet: 'return false;',
        mutatedCode: code.replace('return true;', 'return false;'),
      });
    }
    if (code.includes('return ') && !code.includes('return null;') && !code.includes('return true;')) {
      list.push({
        family: 'RETURN',
        description: 'Premature null return',
        originalSnippet: 'return ',
        mutatedSnippet: 'return null; // mutated\nreturn ',
        mutatedCode: code.replace('return ', 'return null; // mutated\nreturn '),
      });
    }

    // Family 6: ERROR_HANDLING
    if (code.includes('catch (err') || code.includes('catch (error')) {
      list.push({
        family: 'ERROR_HANDLING',
        description: 'Suppress exception handling block',
        originalSnippet: 'catch (err',
        mutatedSnippet: 'catch (_suppressed_err',
        mutatedCode: code.replace(/catch \([a-zA-Z0-9_]+\)\s*\{[^}]*\}/, 'catch () { /* swallowed */ }'),
      });
    }

    // Family 7: ASYNC
    if (code.includes('await ')) {
      list.push({
        family: 'ASYNC',
        description: 'Remove await keyword from asynchronous call',
        originalSnippet: 'await ',
        mutatedSnippet: '/* await omitted */ ',
        mutatedCode: code.replace('await ', '/* await omitted */ '),
      });
    }

    // Family 8: SECURITY
    if (code.includes('.startsWith(') || code.includes('includes(')) {
      list.push({
        family: 'SECURITY',
        description: 'Bypass authorization/boundary validation check',
        originalSnippet: '.startsWith(',
        mutatedSnippet: '.includes("") || .startsWith(',
        mutatedCode: code.replace(/\.startsWith\([^)]+\)/, 'true /* security boundary bypassed */'),
      });
    }

    return list;
  }
}
