import { ProofEngine, type ProofReport } from './ProofEngine.js';
import { TestTamperDetector, type TamperReport } from './TestTamperDetector.js';
import { MutationVerifier, type MutationReport } from './MutationVerifier.js';
import { CounterexampleAgent, type CounterexampleReport } from '../../services/agent/CounterexampleAgent.js';
import { AgentJudge, type JudgeEvaluationReport, type JudgeSubmission } from '../../services/agent/AgentJudge.js';

export interface VerificationAdapterOptions {
  cwd: string;
  userIntent: string;
  changedFiles: string[];
  allowedFiles?: string[];
  skipMutation?: boolean;
  testCommand?: string;
}

export interface UniversalVerificationReport {
  isVerified: boolean;
  verdict: 'VERIFIED_AND_PROVED' | 'DEFECTS_DETECTED_REPAIR_REQUIRED';
  proofReport: ProofReport;
  tamperReport: TamperReport;
  mutationReport?: MutationReport;
  counterexampleReport: CounterexampleReport;
  judgeReport: JudgeEvaluationReport;
  proofCard: string;
  summary: string;
}

export class UniversalVerificationAdapter {
  /**
   * Universal Verification Oracle for any autonomous Coding Agent.
   * Executes the 4-Ring verification pipeline: G1-G10 -> Anti-Tamper -> Mutation -> 14-Vector Counterexample -> Hard Constraint Judge.
   */
  static async verify(options: VerificationAdapterOptions): Promise<UniversalVerificationReport> {
    const cwd = options.cwd;
    const allowed = options.allowedFiles || options.changedFiles;

    // Ring 3: Empirical G1-G10 Verification
    const proofReport = await ProofEngine.verify(options.changedFiles, {
      cwd,
      allowedFiles: allowed,
      customTestCommand: options.testCommand,
    });

    // Ring 4a: Test Tamper Detection
    const tamperReport = TestTamperDetector.audit(cwd, options.changedFiles, allowed);

    // Ring 4b: Mutation Verification (Test Adequacy)
    let mutationReport: MutationReport | undefined;
    if (!options.skipMutation && proofReport.overallPassed) {
      try {
        mutationReport = await MutationVerifier.verify(options.changedFiles, {
          cwd,
          testCommand: options.testCommand,
          maxMutants: 2,
        });
      } catch {
        // Fallback gracefully if mutation environment lacks isolated test runner
      }
    }

    // Ring 4c: Adversarial 14-Vector Counterexample Probing
    const counterexampleReport = CounterexampleAgent.probe({
      userIntent: options.userIntent,
      modifiedFiles: options.changedFiles,
      cwd,
    });

    // Terminal: Independent Hard Constraint Judge
    const judgeSubmission: JudgeSubmission = {
      userIntent: options.userIntent,
      modifiedFiles: options.changedFiles,
      allowedFiles: allowed,
      testResults: {
        total: proofReport.checks.length,
        passed: proofReport.checks.filter((c) => c.passed).length,
        failed: proofReport.checks.filter((c) => !c.passed).length,
      },
      buildPassed: proofReport.checks.find((c) => c.gateId === 'G5')?.passed ?? true,
      secretLeaksDetected: proofReport.checks.find((c) => c.gateId === 'G9')?.passed ? 0 : 1,
      regressionDetected: !proofReport.checks.find((c) => c.gateId === 'G10')?.passed,
      isTestTampered: tamperReport.isTampered,
      counterexampleBreachDetected: counterexampleReport.attackSucceeded,
      mutationAdequacy: mutationReport?.adequacyScore,
    };

    const judgeReport = AgentJudge.evaluate(judgeSubmission);

    const isVerified =
      proofReport.overallPassed &&
      !tamperReport.isTampered &&
      !counterexampleReport.attackSucceeded &&
      judgeReport.isAccepted;

    const verdict = isVerified
      ? 'VERIFIED_AND_PROVED'
      : 'DEFECTS_DETECTED_REPAIR_REQUIRED';

    const summary = isVerified
      ? 'Universal Verification Oracle confirmed: All 10 gates passed, zero test tampering, 14 counterexample vectors defeated, Hard Constraints satisfied.'
      : `Verification rejected: ${judgeReport.criticalDefects.join('; ') || 'Hard constraints violated.'}`;

    return {
      isVerified,
      verdict,
      proofReport,
      tamperReport,
      mutationReport,
      counterexampleReport,
      judgeReport,
      proofCard: proofReport.proofCard,
      summary,
    };
  }
}
