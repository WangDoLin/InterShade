import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { SkillCrystallizer } from '../services/skills/SkillCrystallizer.js';
import { SkillDiscoveryTool } from '../tools/agentic/SkillDiscoveryTool.js';
import type { PipelineContext } from '../engine/pipeline/PipelineStage.js';

console.log('[TEST]: Starting Autonomous Skill Crystallizer verification...');

const cwd = process.cwd();
const testSessionId = `sess-${randomUUID().slice(0, 8)}`;

const mockSuccessContext: PipelineContext = {
  userPrompt: 'Fix OAuth token refresh expiry in auth service',
  cwd,
  logs: [],
  appliedPatches: [
    {
      patchId: 'patch-1',
      targetFile: 'src/auth/token-service.ts',
      linesChanged: 8,
      appliedAt: Date.now(),
    },
  ],
  pipelineStatus: 'SUCCESS',
  reproductionVerifiedGreen: true,
  isAuditPassed: true,
  changeBudget: {
    maxFiles: 5,
    maxAddedLines: 80,
    maxDeletedLines: 50,
  },
  auditFindings: [],
  scopeSpec: {
    intentSummary: 'Fix OAuth token refresh expiry in auth service',
    inScopeFiles: ['src/auth/token-service.ts'],
    outOfBoundsFiles: [],
    acceptanceCriteria: ['Token refreshes before expiry'],
    targets: { files: ['src/auth/token-service.ts'], directories: [], symbols: ['refreshToken'] },
    allowedOperations: ['modify'],
    forbiddenPaths: ['.env'],
    confidence: 0.98,
  },
};

// 1. Verify automatic skill crystallization from successful Pipeline
const skill = SkillCrystallizer.crystallizeFromPipeline(mockSuccessContext);
assert.ok(skill);
assert.ok(skill.name.includes('oauth'));
assert.strictEqual(skill.usageCount, 1);
assert.ok(skill.targetPatterns.includes('*.ts'));

const expectedFile = path.join(cwd, '.intershader', 'skills', `${skill.name}.json`);
assert.ok(fs.existsSync(expectedFile));
console.log(`[PASS]: Skill automatically packaged successfully at: ${expectedFile}`);

// 2. Verify loading skills list
const allSkills = SkillCrystallizer.loadSkills(cwd);
assert.ok(allSkills.length >= 1);
const found = allSkills.find((s) => s.id === skill.id);
assert.ok(found);
console.log(`[PASS]: Loaded skills list (${allSkills.length}) successfully`);

// 3. Verify intent matching (Skill Matching)
const matched = SkillCrystallizer.matchSkill('Need to fix OAuth token expiry issue', cwd);
assert.ok(matched);
assert.strictEqual(matched.id, skill.id);
console.log(`[PASS]: Intent accurately matched to skill: ${matched.name}`);

// 4. Verify invariant: Failed pipeline MUST NOT generate a skill
const mockFailedContext: PipelineContext = {
  ...mockSuccessContext,
  pipelineStatus: 'FAILED',
};
const nullSkill = SkillCrystallizer.crystallizeFromPipeline(mockFailedContext);
assert.strictEqual(nullSkill, null);
console.log('[PASS]: Invariant enforced: FAILED pipeline does not produce skill');

// 5. Verify SkillDiscoveryTool
async function testDiscoveryTool() {
  const tool = new SkillDiscoveryTool();
  const output = await tool.execute(
    { intent: 'OAuth token' },
    { cwd, sessionId: testSessionId, permissionMode: 'auto' }
  );
  assert.ok(output.includes('Matched proven skill'));
  assert.ok(output.includes('oauth'));
  console.log('[PASS]: SkillDiscoveryTool executed successfully');
}

testDiscoveryTool().then(() => {
  console.log('[SUCCESS]: ALL STEP 2 TESTS (AUTONOMOUS SKILL CRYSTALLIZER) PASSED 100%!');
});
