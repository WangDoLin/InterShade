import fs from 'node:fs';
import { execSync } from 'node:child_process';
import type { PipelineStage, PipelineContext, StageResult } from '../PipelineStage.js';
import { SkillCrystallizer } from '../../../services/skills/SkillCrystallizer.js';

export class CleanupSynthesisStage implements PipelineStage {
  readonly index = 10;
  readonly name = 'Artifact Cleanup & Walkthrough Synthesis';
  readonly description = 'Removes temporary test scripts and synthesizes the final verified walkthrough report.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    // 1. Cleanup temporary reproduction script
    if (ctx.reproductionScriptPath && ctx.reproductionScriptPath.includes('.intershade_repro') && fs.existsSync(ctx.reproductionScriptPath)) {
      try {
        fs.unlinkSync(ctx.reproductionScriptPath);
        ctx.logs.push('Temporary reproduction script removed.');
      } catch {
        // Ignore unlink error
      }
    }

    // 2. Fetch git diff stat or fall back to patch records
    let diffSummary = 'No git diff changes detected.';
    try {
      const gitStat = execSync('git diff --stat HEAD', { cwd: ctx.cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000 }).trim();
      if (gitStat) diffSummary = gitStat;
    } catch {
      if (ctx.appliedPatches.length > 0) {
        diffSummary = ctx.appliedPatches.map(p => `${p.targetFile} | ${p.linesChanged} line(s)`).join('\n');
      }
    }

    ctx.finalDiff = diffSummary;

    // 3. Factual status evaluation
    let statusDescription = 'Completed successfully';
    if (ctx.pipelineStatus === 'ROLLED_BACK') {
      statusDescription = 'Rolled back (verification failed)';
    } else if (ctx.pipelineStatus === 'REJECTED') {
      statusDescription = 'Rejected by audit (scope or safety defect)';
    } else if (!ctx.isAuditPassed) {
      statusDescription = 'Completed with audit warnings';
    }

    ctx.finalSummary = [
      `Summary of changes:`,
      `- Goal: ${ctx.scopeSpec?.intentSummary || ctx.userPrompt.slice(0, 100)}`,
      `- Verification: ${ctx.reproductionVerifiedGreen ? 'Tests passed' : 'Unverified / Failed'}`,
      `- Status: ${statusDescription}`,
      diffSummary !== 'No git diff changes detected.' ? `- Modified:\n${diffSummary}` : '- No file diff detected.'
    ].join('\n');

    ctx.logs.push(`Synthesis completed with status: ${ctx.pipelineStatus}.`);

    // 4. Autonomous skill crystallization upon verified pipeline success
    let crystallizedSkill: any = null;
    if (ctx.pipelineStatus === 'SUCCESS') {
      try {
        crystallizedSkill = SkillCrystallizer.crystallizeFromPipeline(ctx);
        if (crystallizedSkill) {
          ctx.logs.push(`Autonomous skill crystallized: ${crystallizedSkill.name}`);
        }
      } catch {
        // Non-blocking skill crystallization error
      }
    }

    return {
      success: ctx.pipelineStatus === 'SUCCESS',
      stageName: this.name,
      stageIndex: this.index,
      message: `Synthesis completed with status ${ctx.pipelineStatus}.`,
      details: {
        summary: ctx.finalSummary,
        status: ctx.pipelineStatus,
        appliedPatchesCount: ctx.appliedPatches.length,
        crystallizedSkill: crystallizedSkill?.name || null
      }
    };
  }
}
