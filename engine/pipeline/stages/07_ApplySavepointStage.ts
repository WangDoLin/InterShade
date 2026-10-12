import fs from 'node:fs';
import path from 'node:path';
import type { PipelineStage, PipelineContext, StageResult } from '../PipelineStage.js';
import { TimelineRewindEngine } from '../../../state/TimelineRewindEngine.js';

export class ApplySavepointStage implements PipelineStage {
  readonly index = 7;
  readonly name = 'Safe Patch Application (Savepoint WAL)';
  readonly description = 'Captures a pre-patch Savepoint and safely applies exact substring modifications.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const patches = ctx.candidatePatches || [];
    if (patches.length === 0) {
      return {
        success: false,
        stageName: this.name,
        stageIndex: this.index,
        message: 'No candidate patches available to apply.'
      };
    }

    const selectedPatch = patches.find(p => p.id === ctx.selectedPatchId) || patches[0];
    const targetFullPath = path.resolve(ctx.cwd, selectedPatch.targetFile);

    // 1. Capture atomic Savepoint WAL
    const spId = TimelineRewindEngine.createSavepoint('Pre-apply savepoint', [targetFullPath]);
    ctx.appliedSavepointId = spId;
    ctx.logs.push(`Savepoint recorded: ${spId} for ${selectedPatch.targetFile}.`);

    // 2. Preimage & staleness verification
    try {
      if (selectedPatch.findContent) {
        if (!fs.existsSync(targetFullPath)) {
          TimelineRewindEngine.rollback(spId);
          return {
            success: false,
            stageName: this.name,
            stageIndex: this.index,
            message: `Target file "${selectedPatch.targetFile}" does not exist for modification.`
          };
        }

        const currentContent = fs.readFileSync(targetFullPath, 'utf8');
        if (!currentContent.includes(selectedPatch.findContent)) {
          TimelineRewindEngine.rollback(spId);
          return {
            success: false,
            stageName: this.name,
            stageIndex: this.index,
            message: `Preimage mismatch: target content not found in "${selectedPatch.targetFile}" (stale patch guard).`
          };
        }

        // 3. Transactional atomic application
        const updatedContent = currentContent.replace(selectedPatch.findContent, selectedPatch.replaceContent);
        fs.writeFileSync(targetFullPath, updatedContent, 'utf8');

        // Calculate lines changed
        const originalLines = currentContent.split('\n').length;
        const newLines = updatedContent.split('\n').length;
        const diffLines = Math.abs(newLines - originalLines) + 1;

        ctx.appliedPatches.push({
          patchId: selectedPatch.id,
          targetFile: selectedPatch.targetFile,
          linesChanged: diffLines,
          appliedAt: Date.now()
        });

        ctx.logs.push(`Successfully applied patch ${selectedPatch.id} to ${selectedPatch.targetFile} (${diffLines} lines changed).`);
      } else {
        // Create new file
        fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });
        fs.writeFileSync(targetFullPath, selectedPatch.replaceContent, 'utf8');

        ctx.appliedPatches.push({
          patchId: selectedPatch.id,
          targetFile: selectedPatch.targetFile,
          linesChanged: selectedPatch.replaceContent.split('\n').length,
          appliedAt: Date.now()
        });

        ctx.logs.push(`Successfully created ${selectedPatch.targetFile} via patch ${selectedPatch.id}.`);
      }

      return {
        success: true,
        stageName: this.name,
        stageIndex: this.index,
        message: `Patch ${selectedPatch.id} safely applied with WAL savepoint ${spId}.`,
        details: {
          savepointId: spId,
          appliedPatchId: selectedPatch.id,
          targetFile: selectedPatch.targetFile
        }
      };
    } catch (err: any) {
      // Transaction failure -> immediate rollback
      TimelineRewindEngine.rollback(spId);
      ctx.pipelineStatus = 'ROLLED_BACK';
      ctx.logs.push(`Patch application error: ${err.message}. Savepoint ${spId} rolled back.`);

      return {
        success: false,
        stageName: this.name,
        stageIndex: this.index,
        message: `Patch application failed: ${err.message}. Rolled back.`
      };
    }
  }
}
