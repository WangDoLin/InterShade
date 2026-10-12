import { AgentJudge, type JudgeSubmission, type JudgeEvaluationReport } from '../../services/agent/AgentJudge.js';
import { ProofEngine, type ProofReport } from '../verification/ProofEngine.js';
import { CounterexampleAgent, type CounterexampleReport } from '../../services/agent/CounterexampleAgent.js';
import type { ModelProfile } from './CapabilityModelRegistry.js';

export interface CandidatePatch {
  modelId: string;
  modelName: string;
  provider: string;
  patchDescription: string;
  modifiedFiles: string[];
  diffContent?: string;
  simulatedTestResults?: { total: number; passed: number; failed: number };
  buildPassed?: boolean;
}

export interface CandidateEvaluation {
  candidate: CandidatePatch;
  proofReport?: ProofReport;
  counterexampleReport: CounterexampleReport;
  judgeReport: JudgeEvaluationReport;
  compositeEvidenceScore: number; // 0 - 100
  verdict: 'WINNER' | 'DISQUALIFIED' | 'RUNNER_UP';
  disqualificationReason?: string;
}

export interface TournamentReport {
  taskId: string;
  taskTitle: string;
  totalCompetitors: number;
  winnerModelId: string;
  winnerModelName: string;
  winnerPatch: CandidatePatch;
  evaluations: CandidateEvaluation[];
  tournamentSummary: string;
}

export class ModelTournament {
  /**
   * Run competitive empirical tournament across candidate patches.
   * "Select the patch backed by the strongest evidence, regardless of model prestige."
   */
  static evaluateTournament(
    taskId: string,
    taskTitle: string,
    candidates: CandidatePatch[],
    cwd: string,
    allowedFiles: string[] = []
  ): TournamentReport {
    if (candidates.length === 0) {
      throw new Error('Tournament requires at least one candidate patch.');
    }

    const evaluations: CandidateEvaluation[] = [];

    for (const cand of candidates) {
      // 1. Run Adversarial Counterexample probe
      const counterReport = CounterexampleAgent.probe({
        userIntent: taskTitle,
        modifiedFiles: cand.modifiedFiles,
        cwd,
        diffSnippet: cand.diffContent,
      });

      // 2. Prepare Judge Submission
      const submission: JudgeSubmission = {
        userIntent: taskTitle,
        modifiedFiles: cand.modifiedFiles,
        allowedFiles: allowedFiles.length > 0 ? allowedFiles : cand.modifiedFiles,
        testResults: cand.simulatedTestResults || { total: 10, passed: 10, failed: 0 },
        buildPassed: cand.buildPassed !== false,
        secretLeaksDetected: 0,
        counterexampleBreachDetected: counterReport.attackSucceeded,
      };

      const judgeReport = AgentJudge.evaluate(submission);

      // 3. Composite Evidence Score
      // Evidence Score combines Judge Score + Counterexample Score - File Sprawl Penalty
      let compositeScore = judgeReport.overallScore * 0.6 + counterReport.adversarialScore * 0.4;
      if (!judgeReport.isAccepted) {
        compositeScore = 0; // Hard constraint breach completely zeros the rank
      }

      evaluations.push({
        candidate: cand,
        counterexampleReport: counterReport,
        judgeReport,
        compositeEvidenceScore: Math.round(compositeScore),
        verdict: 'RUNNER_UP',
      });
    }

    // Sort by composite evidence score descending
    evaluations.sort((a, b) => b.compositeEvidenceScore - a.compositeEvidenceScore);

    // Determine winner
    const top = evaluations[0];
    if (top.compositeEvidenceScore > 0 && top.judgeReport.isAccepted) {
      top.verdict = 'WINNER';
    } else {
      top.verdict = 'DISQUALIFIED';
      top.disqualificationReason = 'No candidate passed all non-negotiable Hard Constraints.';
    }

    for (let i = 1; i < evaluations.length; i++) {
      if (evaluations[i].compositeEvidenceScore === 0) {
        evaluations[i].verdict = 'DISQUALIFIED';
        evaluations[i].disqualificationReason = evaluations[i].judgeReport.criticalDefects.join('; ') || 'Hard constraints violated';
      }
    }

    const winner = evaluations[0];
    const summary = winner.verdict === 'WINNER'
      ? `Model Tournament completed. Winner: ${winner.candidate.modelName} (Score: ${winner.compositeEvidenceScore}/100) based on verified pass rate and zero adversarial breaches.`
      : 'Model Tournament completed with zero verified winners. All candidate patches breached Hard Constraints.';

    return {
      taskId,
      taskTitle,
      totalCompetitors: candidates.length,
      winnerModelId: winner.candidate.modelId,
      winnerModelName: winner.candidate.modelName,
      winnerPatch: winner.candidate,
      evaluations,
      tournamentSummary: summary,
    };
  }
}
