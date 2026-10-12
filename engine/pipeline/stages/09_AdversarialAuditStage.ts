import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { PipelineStage, PipelineContext, StageResult } from '../PipelineStage.js';
import { TimelineRewindEngine } from '../../../state/TimelineRewindEngine.js';

export class AdversarialAuditStage implements PipelineStage {
  readonly index = 9;
  readonly name = 'Adversarial Security & Edge-Case Audit';
  readonly description = 'Acts as an independent adversarial inspector scanning for vulnerabilities and regressions.';

  async execute(ctx: PipelineContext): Promise<StageResult> {
    ctx.logs.push('Executing safety and type verification audit...');

    // 1. Diff Scope Invariant Audit (Hard Gate: actualChangedFiles ⊆ allowedFiles)
    const allowedFiles = ctx.scopeSpec?.inScopeFiles || [];
    const forbidden = ctx.scopeSpec?.forbiddenPaths || [];

    for (const applied of ctx.appliedPatches) {
      const normalized = applied.targetFile.replace(/\\/g, '/');

      // Check if target was allowed
      if (allowedFiles.length > 0 && !allowedFiles.some(af => af.replace(/\\/g, '/') === normalized)) {
        ctx.auditFindings.push({
          severity: 'CRITICAL',
          category: 'DIFF_SCOPE',
          message: `Scope escape violation: Modified file "${applied.targetFile}" was not declared in initial scope.`,
          file: applied.targetFile
        });
      }

      // Check if target hits forbidden paths
      const isForbidden = forbidden.some(fb => {
        const pattern = fb.replace(/\*\*/g, '.*').replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(normalized) || normalized.includes(fb.replace(/\*/g, ''));
      });

      if (isForbidden) {
        ctx.auditFindings.push({
          severity: 'CRITICAL',
          category: 'SECURITY',
          message: `Security boundary violation: Modified file "${applied.targetFile}" is strictly forbidden.`,
          file: applied.targetFile
        });
      }
    }

    // 2. Change Budget Check
    const budget = ctx.changeBudget || { maxFiles: 5, maxAddedLines: 80, maxDeletedLines: 50 };
    const totalFilesChanged = ctx.appliedPatches.length;
    const totalLinesChanged = ctx.appliedPatches.reduce((acc, p) => acc + p.linesChanged, 0);

    if (totalFilesChanged > budget.maxFiles) {
      ctx.auditFindings.push({
        severity: 'CRITICAL',
        category: 'BUDGET',
        message: `Change budget exceeded: ${totalFilesChanged} files changed (max allowed: ${budget.maxFiles}).`
      });
    }

    if (totalLinesChanged > budget.maxAddedLines) {
      ctx.auditFindings.push({
        severity: 'WARNING',
        category: 'BUDGET',
        message: `High diff density: ${totalLinesChanged} lines modified (budget: ${budget.maxAddedLines}).`
      });
    }

    // 3. Secret & Dangerous Code Inspection
    const patches = ctx.candidatePatches || [];
    const appliedPatch = patches.find(p => p.id === ctx.selectedPatchId);
    if (appliedPatch) {
      const content = appliedPatch.replaceContent;
      // Secret leakage regex
      if (/((?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{8,}['"])/i.test(content)) {
        ctx.auditFindings.push({
          severity: 'CRITICAL',
          category: 'SECURITY',
          message: 'Hardcoded secret or credential detected in generated patch replacement.'
        });
      }
      // Dangerous code execution patterns
      if (/\beval\s*\(/.test(content)) {
        ctx.auditFindings.push({
          severity: 'CRITICAL',
          category: 'SECURITY',
          message: 'Use of eval() detected in candidate patch.'
        });
      }
    }

    // 4. Static TypeScript Typecheck Audit
    let typecheckPassed = true;
    const tsconfigPath = path.join(ctx.cwd, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      let tscBin = path.join(ctx.cwd, 'node_modules', 'typescript', 'bin', 'tsc');
      if (!fs.existsSync(tscBin)) {
        const fallbackBin = path.resolve(ctx.cwd, '..', 'InterShade-code-agent', 'node_modules', 'typescript', 'bin', 'tsc');
        if (fs.existsSync(fallbackBin)) {
          tscBin = fallbackBin;
        }
      }

      try {
        if (fs.existsSync(tscBin)) {
          execSync(`node "${tscBin}" --noEmit`, {
            cwd: ctx.cwd,
            stdio: 'pipe',
            timeout: 45000
          });
        } else {
          execSync('npx tsc --noEmit', {
            cwd: ctx.cwd,
            stdio: 'pipe',
            timeout: 45000
          });
        }
      } catch (err: any) {
        const output = (err.stdout?.toString() || '') + '\n' + (err.stderr?.toString() || '') + '\n' + (err.message || '');
        const targetFiles = (ctx.appliedPatches || []).map(p => path.basename(p.targetFile));
        const affectsModifiedFiles = targetFiles.some(f => output.includes(f));

        if (affectsModifiedFiles || targetFiles.length === 0) {
          typecheckPassed = false;
          ctx.auditFindings.push({
            severity: 'CRITICAL',
            category: 'TYPE',
            message: `TypeScript typecheck failed on modified files: ${output.slice(0, 300).trim()}`
          });
        } else {
          ctx.auditFindings.push({
            severity: 'INFO',
            category: 'TYPE',
            message: `Pre-existing workspace TypeScript diagnostics detected in untouched files.`
          });
        }
      }
    }

    // 5. Invariant Verdict
    const hasCriticalFindings = ctx.auditFindings.some(f => f.severity === 'CRITICAL');
    ctx.isAuditPassed = typecheckPassed && !hasCriticalFindings;

    if (!ctx.isAuditPassed) {
      ctx.pipelineStatus = 'REJECTED';
      ctx.logs.push('Verification check failed: critical defects or scope violations detected. Reverting changes.');

      // Rollback savepoint
      if (ctx.appliedSavepointId) {
        TimelineRewindEngine.rollback(ctx.appliedSavepointId);
        ctx.logs.push(`Rollback to savepoint ${ctx.appliedSavepointId} completed.`);
      }

      return {
        success: false,
        stageName: this.name,
        stageIndex: this.index,
        message: 'Adversarial audit failed. Code modification rejected and rolled back.',
        details: {
          findingsCount: ctx.auditFindings.length,
          criticalCount: ctx.auditFindings.filter(f => f.severity === 'CRITICAL').length,
          typecheckPassed
        }
      };
    }

    ctx.logs.push('Verification check passed: zero critical defects detected.');

    return {
      success: true,
      stageName: this.name,
      stageIndex: this.index,
      message: 'Verification check successfully passed with 0 critical defects.',
      details: {
        typecheckPassed: true,
        verdict: 'PASS',
        totalFindings: ctx.auditFindings.length
      }
    };
  }
}
