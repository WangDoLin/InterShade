export interface VerificationEvidence {
  typecheckExitCode: number | null;
  testsExecuted: number;
  testsPassed: number;
  modifiedFiles: Set<string>;
  diffSummary: string;
}

export interface ReadinessEvaluation {
  readyToConclude: boolean;
  missingEvidence: string[];
  evidenceSummary: string;
}

export class VerificationEvidenceCollector {
  private evidence: VerificationEvidence = {
    typecheckExitCode: null,
    testsExecuted: 0,
    testsPassed: 0,
    modifiedFiles: new Set<string>(),
    diffSummary: ''
  };

  recordFileModification(filePath: string): void {
    this.evidence.modifiedFiles.add(filePath);
  }

  recordTypecheckResult(exitCode: number): void {
    this.evidence.typecheckExitCode = exitCode;
  }

  recordTestResults(executed: number, passed: number): void {
    this.evidence.testsExecuted += executed;
    this.evidence.testsPassed += passed;
  }

  recordDiffSummary(summary: string): void {
    this.evidence.diffSummary = summary;
  }

  evaluateReadiness(): ReadinessEvaluation {
    const missing: string[] = [];

    // If files were modified, verify that compilation/typecheck was run
    if (this.evidence.modifiedFiles.size > 0) {
      if (this.evidence.typecheckExitCode === null) {
        missing.push('Typecheck verification has not been executed since files were modified.');
      } else if (this.evidence.typecheckExitCode !== 0) {
        missing.push(`Typecheck failed with exit code ${this.evidence.typecheckExitCode}. Regressions must be resolved.`);
      }
    }

    const readyToConclude = missing.length === 0;
    const evidenceSummary = [
      `Files modified: ${this.evidence.modifiedFiles.size}`,
      `Typecheck status: ${this.evidence.typecheckExitCode === 0 ? 'PASSED (code 0)' : this.evidence.typecheckExitCode === null ? 'NOT RUN' : `FAILED (code ${this.evidence.typecheckExitCode})`}`,
      `Tests: ${this.evidence.testsPassed}/${this.evidence.testsExecuted} passed`
    ].join(' | ');

    return {
      readyToConclude,
      missingEvidence: missing,
      evidenceSummary
    };
  }

  getModifiedFiles(): string[] {
    return Array.from(this.evidence.modifiedFiles);
  }

  reset(): void {
    this.evidence = {
      typecheckExitCode: null,
      testsExecuted: 0,
      testsPassed: 0,
      modifiedFiles: new Set<string>(),
      diffSummary: ''
    };
  }
}
