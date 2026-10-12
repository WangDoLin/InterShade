import path from 'node:path';
import type { PipelineStage, PipelineContext, StageResult, AtomicExecutionStep } from '../PipelineStage.js';

export class MinimalPlanStage implements PipelineStage {
  readonly index = 5;
  readonly name = 'Minimal Plan Formulation & Boundary Guarding';
  readonly description = 'Delineates the exact atomic edit steps, strictly preventing scope creep.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const targets = ctx.scopeSpec?.inScopeFiles || [];
    const forbidden = ctx.scopeSpec?.forbiddenPaths || [];

    // Boundary guard check
    for (const file of targets) {
      const normalized = file.replace(/\\/g, '/');
      const isForbidden = forbidden.some(fb => {
        const pattern = fb.replace(/\*\*/g, '.*').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(normalized) || normalized.includes(fb.replace(/\*/g, ''));
      });

      if (isForbidden) {
        return {
          success: false,
          stageName: this.name,
          stageIndex: this.index,
          message: `Boundary violation: Target file "${file}" is in forbidden paths.`
        };
      }
    }

    const steps: AtomicExecutionStep[] = [];
    for (const file of targets) {
      const targetSymbol = ctx.reconManifest?.symbols?.find(s => s.file === file)?.name;
      steps.push({
        targetFile: file,
        action: 'modify',
        targetSymbol,
        operation: 'replace',
        rationale: `Apply minimal diff to satisfy prompt requirement in ${file}`,
        preconditions: [
          `File "${file}" exists and contains target symbol or context`,
          'Workspace state matches clean preimage'
        ],
        postconditions: [
          'Safety invariant satisfied with minimal line additions',
          'Automated tests pass without regressions'
        ]
      });
    }

    ctx.executionPlan = { steps };
    ctx.logs.push(`Formulated execution plan with ${steps.length} target steps.`);

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: `Plan formulated with ${steps.length} steps.`,
      details: {
        stepCount: steps.length,
        boundaryGuardPassed: true
      }
    };
  }
}
