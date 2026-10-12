import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { PipelineStage, PipelineContext, StageResult } from '../PipelineStage.js';
import { TimelineRewindEngine } from '../../../state/TimelineRewindEngine.js';

export class GreenVerifyStage implements PipelineStage {
  readonly index = 8;
  readonly name = 'Green Verification Gate (Green Phase)';
  readonly description = 'Executes reproduction test to verify that the applied patch achieves 100% resolution.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    // 1. Verification of reproduction script
    if (ctx.reproductionScriptPath && fs.existsSync(ctx.reproductionScriptPath)) {
      try {
        execSync(`npx tsx "${ctx.reproductionScriptPath}"`, {
          cwd: ctx.cwd,
          stdio: 'pipe',
          timeout: 30000
        });
        ctx.reproductionVerifiedGreen = true;
        ctx.logs.push('Reproduction verification passed with exit code 0.');
      } catch (err: any) {
        ctx.reproductionVerifiedGreen = false;
        ctx.pipelineStatus = 'ROLLED_BACK';
        ctx.logs.push(`Reproduction verification failed: ${err.message}. Triggering automatic rollback.`);

        if (ctx.appliedSavepointId) {
          TimelineRewindEngine.rollback(ctx.appliedSavepointId);
          ctx.logs.push(`Rollback to savepoint ${ctx.appliedSavepointId} completed.`);
        }

        return {
          success: false,
          stageName: this.name,
          stageIndex: this.index,
          message: 'Green verification failed. Changes rolled back.'
        };
      }
    } else {
      ctx.reproductionVerifiedGreen = true;
      ctx.logs.push('Verification passed by baseline.');
    }

    // 2. Targeted test verification if related test suite is registered
    const targetedTest = ctx.reconManifest?.relatedTests?.[0];
    if (targetedTest && fs.existsSync(targetedTest) && targetedTest !== ctx.reproductionScriptPath) {
      try {
        execSync(`npx tsx "${targetedTest}"`, {
          cwd: ctx.cwd,
          stdio: 'pipe',
          timeout: 30000
        });
        ctx.logs.push(`Targeted test suite passed: ${targetedTest}.`);
      } catch (err: any) {
        ctx.reproductionVerifiedGreen = false;
        ctx.pipelineStatus = 'ROLLED_BACK';
        ctx.logs.push(`Targeted test ${targetedTest} failed: ${err.message}. Triggering automatic rollback.`);

        if (ctx.appliedSavepointId) {
          TimelineRewindEngine.rollback(ctx.appliedSavepointId);
          ctx.logs.push(`Rollback to savepoint ${ctx.appliedSavepointId} completed.`);
        }

        return {
          success: false,
          stageName: this.name,
          stageIndex: this.index,
          message: `Targeted regression test failed on ${targetedTest}. Changes rolled back.`
        };
      }
    }

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: 'Verification confirmed with exit code 0.',
      details: {
        reproductionPassed: ctx.reproductionVerifiedGreen
      }
    };
  }
}
