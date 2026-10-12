import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TenStagePipeline } from '../engine/pipeline/TenStagePipeline.js';
import { TimelineRewindEngine } from '../state/TimelineRewindEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  console.log('=== TEST 10-STAGE PRECISION COGNITIVE PIPELINE ===');

  const pipeline = new TenStagePipeline();

  pipeline.on('stage_start', evt => {
    console.log(`[START] Stage ${evt.index}: ${evt.name}`);
  });

  pipeline.on('stage_complete', evt => {
    console.log(`[DONE]  Stage ${evt.index}: ${evt.name} -> Success: ${evt.result.success} (${evt.result.message})`);
  });

  // Create an isolated fixture file to test full cycle: reproduce -> patch -> apply -> verify
  const fixturePath = path.resolve(projectRoot, 'tests/fixture-target.ts');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, `// Fixture for testing 10-stage pipeline
export class TokenService {
  public validate(token: string | null): boolean {
    return true;
  }
}
`, 'utf8');

  try {
    const prompt = 'Fix null token verification in tests/fixture-target.ts';
    console.log(`Running pipeline with prompt: "${prompt}"\n`);

    const report = await pipeline.run(prompt, projectRoot);

    console.log('\n--- PIPELINE EXECUTION REPORT ---');
    console.log(`Overall Success: ${report.success}`);
    console.log(`Pipeline Status: ${report.context.pipelineStatus}`);
    console.log(`Total Stages Executed: ${report.totalStagesExecuted} / 10`);
    console.log(`Execution Duration: ${report.durationMs}ms`);
    console.log(`Audit Passed: ${report.context.isAuditPassed}`);
    console.log(`Green Verified: ${report.context.reproductionVerifiedGreen}`);
    console.log(`Applied Patches: ${report.context.appliedPatches.length}`);

    console.log('\n--- FINAL SYNTHESIS SUMMARY ---');
    console.log(report.context.finalSummary);

    // Verify fixture content was patched
    const patchedContent = fs.readFileSync(fixturePath, 'utf8');
    const hasPatch = patchedContent.includes('InterShader verified guard') || patchedContent.includes('Safety check');
    console.log(`Fixture file was modified on disk: ${hasPatch}`);

    console.log('\n=== TEST 2: BOUNDARY JAIL GUARD (OUT-OF-BOUNDS ATTEMPT) ===');
    const jailPrompt = 'Modify ../outside.env';
    const jailReport = await pipeline.run(jailPrompt, projectRoot);
    console.log(`Jail attempt success: ${jailReport.success} (Status: ${jailReport.context.pipelineStatus})`);

    console.log('\n=== TEST 3: SAVEPOINT & ROLLBACK ENGINE ===');
    const spId = TimelineRewindEngine.createSavepoint('unit_test_savepoint', [fixturePath]);
    console.log(`Created savepoint: ${spId}`);
    const rolledBack = TimelineRewindEngine.rollback(spId);
    console.log(`Rollback result: ${rolledBack}`);

    if (report.success && report.context.pipelineStatus === 'SUCCESS' && !jailReport.success && rolledBack) {
      console.log('\nALL 10 STAGES, JAIL GUARD, AND ROLLBACK TESTS COMPLETED SUCCESSFULLY.');
    } else {
      console.error('\nPIPELINE FAILED ACCEPTANCE CRITERIA.');
      process.exit(1);
    }
  } finally {
    if (fs.existsSync(fixturePath)) {
      fs.unlinkSync(fixturePath);
    }
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
