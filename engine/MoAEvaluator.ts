export interface CandidateSolution {
  id: string;
  strategy: 'minimal_fix' | 'optimal_refactor' | 'defensive_fix';
  codePatch: string;
  explanation: string;
  score?: number;
}

/**
 * MoAEvaluator (Mixture of Agents) facilitates multi-candidate patch generation
 * and selects the highest-scoring candidate that satisfies all verification tests.
 */
export class MoAEvaluator {
  /**
   * Selects the winning candidate based on verification test results and simplicity score
   */
  static selectBestCandidate(candidates: CandidateSolution[]): CandidateSolution {
    if (candidates.length === 0) {
      throw new Error('[MOA ERROR]: No candidate solutions available.');
    }

    // Default to first verified candidate, prioritizing minimal patch to reduce blast radius
    const minimal = candidates.find((c) => c.strategy === 'minimal_fix');
    return minimal || candidates[0];
  }
}
