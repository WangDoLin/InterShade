import assert from 'node:assert';
import path from 'node:path';
import { SkillRegistry } from '../services/skills/SkillRegistry.js';
import { SkillHubClient } from '../services/skills/SkillHubClient.js';
import { SkillSecurityAuditor } from '../services/skills/SkillSecurityAuditor.js';
import { skillsCommand } from '../cli/commands/builtinCommands.js';

async function runSkillEcosystemSuite() {
  console.log('[TEST]: Starting Skill Ecosystem & SkillHub Verification Suite...\n');

  const cwd = process.cwd();
  const registry = new SkillRegistry(cwd);

  // --- Test 1: Multi-Root Discovery Bridge (Built-in + Global IDE Skills) ---
  console.log('--- 1. Testing Multi-Root Discovery Bridge (Built-in + Global IDE Skills) ---');
  const allSkills = registry.discoverAllSkills();
  console.log(`Discovered total ${allSkills.length} skills across all tiers!`);

  assert.ok(allSkills.length >= 25, `Expected at least 25 skills discovered, got ${allSkills.length}`);

  const builtinSkills = allSkills.filter((s) => s.tier === 'builtin');
  const globalSkills = allSkills.filter((s) => s.tier === 'global');

  console.log(`- Builtin Tier Skills: ${builtinSkills.length}`);
  console.log(`- Global IDE Tier Skills: ${globalSkills.length}`);

  assert.ok(builtinSkills.length >= 17, `Expected at least 17 builtin skills, got ${builtinSkills.length}`);
  assert.ok(globalSkills.length >= 10, `Expected at least 10 global IDE skills, got ${globalSkills.length}`);

  // Check that our 5 new elite skills exist in builtin
  const expectedNewSkills = [
    'architecture-stress-test',
    'test-driven-acceptance-gate',
    'security-differential-review',
    'documentation-auto-sync',
    'database-zero-downtime-migration',
  ];

  for (const name of expectedNewSkills) {
    const found = builtinSkills.find((s) => s.metadata.name === name);
    assert.ok(found, `Expected new skill '${name}' to be discovered in builtin tier`);
  }
  console.log('[PASS]: Multi-Root Discovery Bridge successfully detected Builtin and Global IDE skills!\n');

  // --- Test 2: Multiline Folded Frontmatter Parser ---
  console.log('--- 2. Testing Multiline YAML Frontmatter Parser ---');
  const testYaml = `---
name: sample-folded-skill
description: >
  This is a multi-line folded description
  that spans across multiple indented lines
  and should be merged into a single clean sentence.
license: MIT
version: 2.1.0
tags: [folding, yaml, test]
---
# Instructions
Sample content
`;
  const parsed = SkillRegistry.parseFrontmatter(testYaml);
  assert.strictEqual(parsed.frontmatter.name, 'sample-folded-skill');
  assert.ok(parsed.frontmatter.description?.includes('multi-line folded description'));
  assert.ok(parsed.frontmatter.description?.includes('clean sentence'));
  assert.deepStrictEqual(parsed.frontmatter.tags, ['folding', 'yaml', 'test']);
  console.log('[PASS]: Multiline YAML Frontmatter Parser handled folded descriptions perfectly!\n');

  // --- Test 3: SkillHubClient Catalog Search ---
  console.log('--- 3. Testing SkillHubClient Search ---');
  const hub = new SkillHubClient(cwd);
  const searchResult = hub.search('playwright');

  assert.ok(
    searchResult.local.length > 0 || searchResult.remote.length > 0,
    'Expected search results for "playwright"'
  );
  console.log(`Found ${searchResult.local.length} local and ${searchResult.remote.length} remote catalog matches for "playwright"`);
  console.log('[PASS]: SkillHubClient successfully searched local and remote catalog!\n');

  // --- Test 4: Security Auditor on New Skills ---
  console.log('--- 4. Testing Security Auditor on Newly Implemented Skills ---');
  for (const name of expectedNewSkills) {
    const skillPkg = registry.getSkill(name);
    assert.ok(skillPkg, `Skill '${name}' must be retrieved from registry`);
    const audit = SkillSecurityAuditor.auditSkill(skillPkg);
    console.log(`Audit ${name}: MaxSeverity ${audit.maxSeverity}, Passed: ${audit.passed}, Findings: ${audit.findings.length}`);
    assert.ok(audit.passed, `Skill '${name}' should pass security audit`);
    assert.strictEqual(audit.maxSeverity, 'PASS', `Skill '${name}' should have PASS maxSeverity`);
  }
  console.log('[PASS]: All newly authored skills passed Security Audit with high scores!\n');

  // --- Test 5: /skills Command Handlers ---
  console.log('--- 5. Testing /skills Command Handlers ---');
  const listOutput = await skillsCommand.execute({ cwd, sessionState: {}, args: ['list'] });
  assert.ok(typeof listOutput === 'string' && listOutput.includes('InterShader Integrated Skills Ecosystem'));
  assert.ok(listOutput.includes('Built-in Core Tier'));
  assert.ok(listOutput.includes('Global IDE Tier'));

  const infoOutput = await skillsCommand.execute({ cwd, sessionState: {}, args: ['info', 'architecture-stress-test'] });
  assert.ok(typeof infoOutput === 'string' && infoOutput.includes('architecture-stress-test'));
  assert.ok(infoOutput.includes('Tier:         builtin'));

  const searchOutput = await skillsCommand.execute({ cwd, sessionState: {}, args: ['search', 'security'] });
  assert.ok(typeof searchOutput === 'string' && searchOutput.includes('Skill Search Results'));

  const sessionState: Record<string, unknown> = {};
  const activateOutput = await skillsCommand.execute({ cwd, sessionState, args: ['activate', 'architecture-stress-test'] });
  assert.ok(typeof activateOutput === 'string' && activateOutput.includes('Skill Activated'));
  assert.strictEqual(sessionState.activeSkill, 'architecture-stress-test');
  console.log('[PASS]: /skills command execute handlers verified successfully!\n');

  console.log('================================================================');
  console.log('🎉 ALL SKILL ECOSYSTEM & SKILLHUB SUITE TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runSkillEcosystemSuite().catch((err) => {
  console.error('[FAIL]:', err);
  process.exit(1);
});
