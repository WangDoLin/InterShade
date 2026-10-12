import { BenchmarkMetricsEngine, type MetricScorecard, type RawTaskObservation, type MutationFamilyBreakdown } from './BenchmarkMetricsEngine.js';

export type DefectCategory =
  | 'RACE_CONDITION'
  | 'SECURITY_INJECTION'
  | 'API_CONTRACT'
  | 'CONCURRENCY_LOCK'
  | 'STATE_CORRUPTION'
  | 'FILESYSTEM_ESCAPE'
  | 'DATABASE_INTEGRITY'
  | 'ASYNC_TIMING'
  | 'DEPENDENCY_CONFLICT'
  | 'CONFIGURATION_DRIFT';

export interface FixBenchmarkTask {
  taskId: string;
  category: DefectCategory;
  name: string;
  defectDescription: string;
  expectedRepairType: string;
  execute: () => Promise<RawTaskObservation>;
}

export interface CleanBenchmarkTask {
  taskId: string;
  name: string;
  cleanCodeDescription: string;
  execute: () => Promise<RawTaskObservation>;
}

export interface BenchmarkSuiteResult {
  totalExecuted: number;
  fixBenchmarkResults: MetricScorecard;
  cleanBenchmarkResults: MetricScorecard;
  comprehensiveScorecard: MetricScorecard;
}

export class BenchmarkHarness {
  private fixTasks: FixBenchmarkTask[] = [];
  private cleanTasks: CleanBenchmarkTask[] = [];

  /**
   * Register a defect fix task (measures detection, repair, and final verification)
   */
  registerFixTask(task: FixBenchmarkTask): void {
    this.fixTasks.push(task);
  }

  /**
   * Register a clean task (measures false positive rate and scope preservation)
   */
  registerCleanTask(task: CleanBenchmarkTask): void {
    this.cleanTasks.push(task);
  }

  /**
   * Run all registered fix benchmark tasks
   */
  async runFixSuite(): Promise<{ observations: RawTaskObservation[]; scorecard: MetricScorecard }> {
    const observations: RawTaskObservation[] = [];
    for (const task of this.fixTasks) {
      const obs = await task.execute();
      observations.push(obs);
    }
    const scorecard = BenchmarkMetricsEngine.computeMetrics(observations);
    return { observations, scorecard };
  }

  /**
   * Run all registered clean benchmark tasks
   */
  async runCleanSuite(): Promise<{ observations: RawTaskObservation[]; scorecard: MetricScorecard }> {
    const observations: RawTaskObservation[] = [];
    for (const task of this.cleanTasks) {
      const obs = await task.execute();
      observations.push(obs);
    }
    const scorecard = BenchmarkMetricsEngine.computeMetrics(observations);
    return { observations, scorecard };
  }

  /**
   * Run comprehensive evaluation combining both fix and clean task benchmarks
   */
  async runComprehensive(): Promise<BenchmarkSuiteResult> {
    const { observations: fixObs, scorecard: fixScorecard } = await this.runFixSuite();
    const { observations: cleanObs, scorecard: cleanScorecard } = await this.runCleanSuite();
    
    const combinedObservations = [...fixObs, ...cleanObs];
    const comprehensiveScorecard = BenchmarkMetricsEngine.computeMetrics(combinedObservations);

    return {
      totalExecuted: combinedObservations.length,
      fixBenchmarkResults: fixScorecard,
      cleanBenchmarkResults: cleanScorecard,
      comprehensiveScorecard,
    };
  }

  /**
   * Factory to construct standard reference task observation with 8 mutation families
   */
  static createReferenceObservation(params: {
    taskId: string;
    oracleSuccess: boolean;
    evaluatorSuccess: boolean;
    repaired: boolean;
    mutantsTotal: number;
    mutantsKilled: number;
    mutationFamilies?: Partial<MutationFamilyBreakdown>;
    counterexamplesApplicable?: number;
    counterexamplesReproduced?: number;
    repairTriggered?: boolean;
    repairSucceeded?: boolean;
    isAttack?: boolean;
    attackType?: 'TEST_TAMPER' | 'UNAUTHORIZED_KEY' | 'FORGED_PROOF' | 'REPLAY_ATTACK';
  }): RawTaskObservation {
    return {
      taskId: params.taskId,
      agentClaimedSuccess: true,
      oracleVerifiedSuccess: params.oracleSuccess,
      independentEvaluatorSuccess: params.evaluatorSuccess,
      firstPass: !params.repaired && params.oracleSuccess,
      repaired: params.repaired,
      hiddenTestsPassed: params.oracleSuccess,
      hiddenTestSensitivity: params.oracleSuccess ? 96.0 : 50.0,
      mutantsTotal: params.mutantsTotal,
      mutantsKilled: params.mutantsKilled,
      mutationFamilyBreakdown: {
        relational: params.mutationFamilies?.relational ?? 89,
        logical: params.mutationFamilies?.logical ?? 89,
        controlFlow: params.mutationFamilies?.controlFlow ?? 88,
        valueMutation: params.mutationFamilies?.valueMutation ?? 70,
        returnMutation: params.mutationFamilies?.returnMutation ?? 70,
        errorHandling: params.mutationFamilies?.errorHandling ?? 85,
        asyncOp: params.mutationFamilies?.asyncOp ?? 86,
        security: params.mutationFamilies?.security ?? 89,
      },
      counterexamplesDefined: 14,
      counterexamplesApplicable: params.counterexamplesApplicable ?? 1,
      counterexamplesReproduced: params.counterexamplesReproduced ?? 1,
      repairTriggered: params.repairTriggered ?? params.repaired,
      repairAttempted: params.repairTriggered ?? params.repaired,
      repairSucceeded: params.repairSucceeded ?? params.repaired,
      repairIterations: params.repaired ? 1 : 0,
      regressionsDetected: 0,
      humanInterventions: 0,
      isAttackTask: params.isAttack,
      attackType: params.attackType,
      evidenceFilesExpected: 10,
      evidenceFilesActual: 10,
      attestationValid: !params.isAttack && params.oracleSuccess,
      verdict: params.oracleSuccess ? 'VERIFIED' : 'REJECTED',
    };
  }
}
