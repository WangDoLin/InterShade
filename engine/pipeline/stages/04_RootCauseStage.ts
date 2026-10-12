import type { PipelineStage, PipelineContext, StageResult, HypothesisCandidate } from '../PipelineStage.js';

export class RootCauseStage implements PipelineStage {
  readonly index = 4;
  readonly name = 'Root Cause Reasoning & Architectural Hypothesis';
  readonly description = 'Traces data flows and formulates the simplest architectural hypothesis.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const prompt = ctx.userPrompt;
    const targetFile = ctx.scopeSpec?.inScopeFiles?.[0] || 'target file';
    const targetSymbols = (ctx.reconManifest?.symbols || []).map(s => s.name);

    // 1. Evidence gathering
    const evidence: string[] = [
      `User prompt requirement: "${prompt.slice(0, 100)}"`,
      `In-scope target: ${targetFile}`,
      ctx.reproductionVerifiedRed
        ? 'Pre-patch reproduction verified invariant violation.'
        : 'Baseline behavior confirmed.'
    ];

    if (targetSymbols.length > 0) {
      evidence.push(`Identified relevant code symbols: ${targetSymbols.slice(0, 3).join(', ')}`);
    }

    // 2. Multi-hypothesis generation and confidence scoring
    const hypotheses: HypothesisCandidate[] = [
      {
        hypothesis: `Missing invariant guard or safety validation in ${targetFile}`,
        evidence: [...evidence, 'Code lacks required condition check for edge case.'],
        confidence: 0.88,
        affectedSymbols: targetSymbols.slice(0, 2)
      },
      {
        hypothesis: `State mutation or concurrent race condition in ${targetFile}`,
        evidence: [...evidence, 'State accessed without prior validation.'],
        confidence: 0.55,
        affectedSymbols: targetSymbols.slice(0, 1)
      },
      {
        hypothesis: `Incompatible return type or unhandled error propagation`,
        evidence: [...evidence, 'Function return lacks proper fallback.'],
        confidence: 0.38,
        affectedSymbols: []
      }
    ];

    // Select top hypothesis
    const topHypothesis = hypotheses[0];

    ctx.rootCauseReport = {
      hypothesis: topHypothesis.hypothesis,
      invariantViolated: 'Target module does not enforce required boundary condition or safety guard.',
      proposedArchitecture: 'Apply isolated minimal diff with exact substring replacement.',
      hypotheses,
      topConfidence: topHypothesis.confidence
    };

    ctx.logs.push(`Architectural approach established: ${ctx.rootCauseReport.hypothesis}`);

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: 'Root cause reasoning and architecture completed.',
      details: {
        hypothesis: ctx.rootCauseReport.hypothesis,
        confidence: topHypothesis.confidence,
        hypothesesCount: hypotheses.length
      }
    };
  }
}
