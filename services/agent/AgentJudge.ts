export interface ScoreDimension {
  name: string;
  weight: number; // 0.0 - 1.0
  score: number;  // 0 - 100
  notes: string;
}

export interface HardConstraintCheck {
  name: string;
  passed: boolean;
  reason: string;
}

export type JudgeVerdict = 'ACCEPT' | 'REJECT';
export type QualityTier = 'EXCELLENT' | 'ACCEPTABLE' | 'REJECT';

export interface JudgeEvaluationReport {
  overallScore: number;
  isAccepted: boolean;
  verdict: JudgeVerdict;
  tierClassification: QualityTier;
  hardConstraints: HardConstraintCheck[];
  dimensions: ScoreDimension[];
  criticalDefects: string[];
  recommendations: string[];
}

export interface JudgeSubmission {
  userIntent: string;
  modifiedFiles: string[];
  allowedFiles: string[];
  testResults: { total: number; passed: number; failed: number };
  buildPassed: boolean;
  secretLeaksDetected: number;
  regressionDetected?: boolean;
  isTestTampered?: boolean;
  mutationAdequacy?: number; // 0 - 100
  counterexampleBreachDetected?: boolean;
}

export class AgentJudge {
  static readonly ACCEPTANCE_THRESHOLD = 85;
  static readonly EXCELLENCE_THRESHOLD = 95;

  /**
   * Two-Tier Independent Judge Architecture:
   * Tier 1: Hard Constraints Barrier (Correctness, Security, Scope, Build, Tests, Evidence Integrity)
   * Tier 2: Quality Grading (Score never overrides correctness failures)
   */
  static evaluate(submission: JudgeSubmission): JudgeEvaluationReport {
    const criticalDefects: string[] = [];
    const recommendations: string[] = [];
    const hardConstraints: HardConstraintCheck[] = [];

    // ====================================================
    // TIER 1: HARD CONSTRAINTS BARRIER (NON-NEGOTIABLE)
    // ====================================================

    // 1. Build Integrity
    const buildOk = submission.buildPassed === true;
    hardConstraints.push({
      name: 'Build Integrity',
      passed: buildOk,
      reason: buildOk ? 'Code compiles and builds cleanly' : 'Build failed: compilation errors prevent execution',
    });
    if (!buildOk) {
      criticalDefects.push('Build pipeline failed: code cannot compile.');
    }

    // 2. Test Correctness & Regressions
    const testsOk = submission.testResults.failed === 0 && (submission.testResults.total > 0 || submission.buildPassed);
    hardConstraints.push({
      name: 'Test Invariants & Zero Failures',
      passed: testsOk,
      reason: testsOk
        ? `All ${submission.testResults.passed} tests passed with 0 failures`
        : `${submission.testResults.failed} test(s) failed in verification`,
    });
    if (submission.testResults.failed > 0) {
      criticalDefects.push(`${submission.testResults.failed} test(s) failed in verification.`);
    }

    // 3. Security & Secret Leaks
    const securityOk = submission.secretLeaksDetected === 0;
    hardConstraints.push({
      name: 'Security Non-Leakage',
      passed: securityOk,
      reason: securityOk
        ? 'Zero leaked credentials, keys, or SAST injection risks'
        : `Detected ${submission.secretLeaksDetected} potential unredacted credential leaks`,
    });
    if (!securityOk) {
      criticalDefects.push(`Detected ${submission.secretLeaksDetected} potential unredacted credential leaks.`);
    }

    // 4. Scope & Boundary Containment (Diff Guard)
    const outOfBounds = submission.modifiedFiles.filter((f) => !submission.allowedFiles.includes(f));
    const scopeOk = outOfBounds.length === 0;
    hardConstraints.push({
      name: 'Scope & Boundary Containment',
      passed: scopeOk,
      reason: scopeOk
        ? 'All modified files strictly confined within target boundary'
        : `Modified out-of-bounds files: ${outOfBounds.join(', ')}`,
    });
    if (!scopeOk) {
      criticalDefects.push(`Modified out-of-bounds files: ${outOfBounds.join(', ')}`);
    }

    // 5. Invariant Regression Guard
    const regressionOk = !submission.regressionDetected;
    hardConstraints.push({
      name: 'Zero Collateral Regressions',
      passed: regressionOk,
      reason: regressionOk
        ? 'No collateral regression observed in surrounding systems'
        : 'Regression detected: existing features broken by patch',
    });
    if (!regressionOk) {
      criticalDefects.push('Regression detected: patch broke existing system behavior.');
    }

    // 6. Evidence Authenticity & Test Integrity Guard (Anti-Tamper)
    const tamperOk = !submission.isTestTampered;
    hardConstraints.push({
      name: 'Evidence Authenticity & Test Integrity',
      passed: tamperOk,
      reason: tamperOk
        ? 'Test suite assertions authentic and untampered'
        : 'Test tamper detected: unauthorized test alteration or suppressed assertions',
    });
    if (!tamperOk) {
      criticalDefects.push('Test tamper detected: agent modified or weakened test assertions to bypass gates.');
    }

    // 7. Adversarial Counterexample Penetration Guard
    const counterOk = !submission.counterexampleBreachDetected;
    hardConstraints.push({
      name: 'Adversarial Counterexample Invariance',
      passed: counterOk,
      reason: counterOk
        ? 'Zero reproducible counterexamples penetrated the implementation'
        : 'Counterexample breach confirmed: implementation fails under adversarial probing',
    });
    if (!counterOk) {
      criticalDefects.push('Adversarial counterexample reproduced a defect in production logic.');
    }

    const allHardConstraintsPassed = hardConstraints.every((h) => h.passed);

    // ====================================================
    // TIER 2: QUALITY SCORING (WEIGHTED COMPOSITION)
    // ====================================================
    const dimensions: ScoreDimension[] = [];

    // 1. Correctness (Weight: 30%)
    let correctnessScore = 100;
    if (!submission.buildPassed) correctnessScore -= 60;
    if (submission.testResults.failed > 0) correctnessScore -= 40;
    correctnessScore = Math.max(0, correctnessScore);
    dimensions.push({
      name: 'Correctness',
      weight: 0.30,
      score: correctnessScore,
      notes: submission.buildPassed && submission.testResults.failed === 0
        ? 'Build passed and all verification tests green.'
        : 'Critical functional regressions detected.',
    });

    // 2. Tests & Verification Rigor (Weight: 25%)
    let testScore = 100;
    if (submission.testResults.total === 0) {
      testScore = 40;
      recommendations.push('Add dedicated regression tests asserting the bugfix.');
    } else {
      const passRate = submission.testResults.passed / submission.testResults.total;
      testScore = Math.round(passRate * 100);
    }
    if (submission.mutationAdequacy !== undefined) {
      testScore = Math.round(testScore * 0.7 + submission.mutationAdequacy * 0.3);
    }
    dimensions.push({
      name: 'Tests & Invariants',
      weight: 0.25,
      score: testScore,
      notes: `Test execution pass rate & mutation adequacy: ${testScore}%.`,
    });

    // 3. Security (Weight: 20%)
    let securityScore = 100;
    if (submission.secretLeaksDetected > 0) {
      securityScore = 0;
    }
    dimensions.push({
      name: 'Security & Safety',
      weight: 0.20,
      score: securityScore,
      notes: submission.secretLeaksDetected === 0
        ? 'Zero secret leaks or permission boundary breaches.'
        : 'Severe credential leak hazard.',
    });

    // 4. Scope & Boundary (Weight: 15%)
    let scopeScore = 100;
    if (outOfBounds.length > 0) {
      scopeScore -= outOfBounds.length * 30;
    }
    scopeScore = Math.max(0, scopeScore);
    dimensions.push({
      name: 'Scope & Boundary Control',
      weight: 0.15,
      score: scopeScore,
      notes: outOfBounds.length === 0
        ? 'All modifications strictly confined within target boundary.'
        : `File sprawl: ${outOfBounds.length} forbidden file(s) modified.`,
    });

    // 5. Code Quality & Cleanliness (Weight: 10%)
    const qualityScore = submission.modifiedFiles.length > 8 ? 70 : 95;
    dimensions.push({
      name: 'Code Quality',
      weight: 0.10,
      score: qualityScore,
      notes: 'Surgical minimal modifications adhering to convention.',
    });

    let totalScore = 0;
    for (const d of dimensions) {
      totalScore += d.score * d.weight;
    }
    const finalScore = Math.round(totalScore);

    // Hard Constraint Rule: Score NEVER overrides hard constraints
    let verdict: JudgeVerdict = 'REJECT';
    let isAccepted = false;
    let tierClassification: QualityTier = 'REJECT';

    if (allHardConstraintsPassed && criticalDefects.length === 0) {
      if (finalScore >= this.EXCELLENCE_THRESHOLD) {
        verdict = 'ACCEPT';
        isAccepted = true;
        tierClassification = 'EXCELLENT';
      } else if (finalScore >= this.ACCEPTANCE_THRESHOLD) {
        verdict = 'ACCEPT';
        isAccepted = true;
        tierClassification = 'ACCEPTABLE';
      } else {
        verdict = 'REJECT';
        isAccepted = false;
        tierClassification = 'REJECT';
        recommendations.push(`Score ${finalScore} is below threshold ${this.ACCEPTANCE_THRESHOLD}. Refine code quality.`);
      }
    } else {
      verdict = 'REJECT';
      isAccepted = false;
      tierClassification = 'REJECT';
    }

    return {
      overallScore: finalScore,
      isAccepted,
      verdict,
      tierClassification,
      hardConstraints,
      dimensions,
      criticalDefects,
      recommendations,
    };
  }
}
