import assert from 'node:assert';
import path from 'node:path';
import { SkillRegistry } from '../services/skills/SkillRegistry.js';
import { PromptCacheManager } from '../context/PromptCacheManager.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { getClaudeAgentRole, CLAUDE_AGENT_ROLES, type ClaudeAgentRoleType } from '../services/agent/ClaudeAgentRoles.js';
import { SubagentTool } from '../tools/agentic/SubagentTool.js';
import { skillsCommand } from '../cli/commands/builtinCommands.js';
import type { ToolExecutionContext } from '../types/index.js';

console.log('[TEST]: Starting InterShader Advanced Agent & 12-Skill Ecosystem Verification...');

const rootDir = process.cwd();
const mockContext: ToolExecutionContext = {
  sessionId: 'test-agent-skills',
  cwd: rootDir,
  permissionMode: 'auto',
};

// =========================================================================
// TEST 1: Discovery of All 12 Core Skills
// =========================================================================
console.log('\n--- Test 1: Discovery of All 12 Core Skills ---');
const registry = new SkillRegistry(rootDir, rootDir);
const allSkills = registry.discoverAllSkills();
console.log(`Discovered ${allSkills.length} skills in workspace.`);

const expectedSkills = [
  'agent-tool-executor',
  'cicd-deployment-orchestrator',
  'cloud-provider-adapter',
  'security-audit-snyk-guard',
  'test-automation-vitest',
  'typescript-nodejs-analyzer',
  'fullstack-web-architect',
  'database-sql-optimizer',
  'python-advanced-engineer',
  'devops-docker-kubernetes',
  'performance-profiler-debugger',
  'git-workflow-pro',
];

for (const name of expectedSkills) {
  const found = allSkills.find((s) => s.metadata.name === name);
  assert.ok(found, `Expected skill "${name}" must be discovered`);
  assert.ok(found.contentSha256, `Skill "${name}" must have SHA-256 content hash`);
  assert.ok(found.content.length > 100, `Skill "${name}" must contain instructions`);
  console.log(`  [PASS] Discovered skill: ${name} (v${found.metadata.version})`);
}

// =========================================================================
// TEST 2: Intent-based Skill Auto-Matching
// =========================================================================
console.log('\n--- Test 2: Intent-based Skill Auto-Matching ---');
const testCases = [
  { intent: 'Optimize slow PostgreSQL queries and missing indexes', expected: 'database-sql-optimizer' },
  { intent: 'Build modern React frontend with Next.js SSR and Tailwind', expected: 'fullstack-web-architect' },
  { intent: 'Analyze CPU bottlenecks and debug memory leak with flamegraph', expected: 'performance-profiler-debugger' },
  { intent: 'Docker containerization and Kubernetes Helm deployment', expected: 'devops-docker-kubernetes' },
  { intent: 'Git interactive rebase conflict resolution and clean history', expected: 'git-workflow-pro' },
  { intent: 'FastAPI Python asyncio type hints and Pydantic models', expected: 'python-advanced-engineer' },
];

for (const tc of testCases) {
  const matches = registry.matchSkillsByIntent(tc.intent, 3);
  assert.ok(matches.length > 0, `Expected matches for intent: "${tc.intent}"`);
  const topMatch = matches[0].name;
  assert.strictEqual(topMatch, tc.expected, `Top match for "${tc.intent}" should be "${tc.expected}", got "${topMatch}"`);
  console.log(`  [PASS] Intent "${tc.intent}" -> Matched: [${topMatch}]`);
}

// =========================================================================
// TEST 3: Prompt Cache Manager & QueryEngine Integration
// =========================================================================
console.log('\n--- Test 3: Prompt Cache Manager & QueryEngine Integration ---');
const catalog = registry.getSkillCatalog();
const workflowText = registry.getSkillInstructions('fullstack-web-architect') || '';

const blocks = PromptCacheManager.buildPromptCacheBlocks(
  'You are InterShader AI.',
  [],
  {
    cwd: rootDir,
    model: 'claude-3-7-sonnet',
    sessionDate: '2026-10-13',
    availableSkills: catalog,
    activeSkillWorkflow: { name: 'fullstack-web-architect', instructions: workflowText },
  }
);

assert.ok(blocks.staticBlock.text.includes('Available Engineering Skills'), 'Static prefix must contain skills catalog');
assert.ok(blocks.staticBlock.text.includes('fullstack-web-architect'), 'Static prefix must list skills');
assert.strictEqual(blocks.staticBlock.cacheControl?.type, 'ephemeral', 'Static block must be tagged ephemeral for KV caching');
assert.ok(blocks.dynamicBlock.text.includes('Active Engineering Skill: fullstack-web-architect'), 'Dynamic block must inject active skill');
assert.ok(blocks.dynamicBlock.text.includes('Architectural Foundation'), 'Dynamic block must contain skill content');
console.log('[PASS] Prompt cache blocks correctly separate static catalog and dynamic workflow.');

const queryEngine = new QueryEngine({
  cwd: rootDir,
  model: 'claude-3-7-sonnet',
  provider: 'anthropic',
  permissionMode: 'auto',
  resumeSession: false,
  maxTokens: 4096,
});
assert.strictEqual(queryEngine.getActiveSkill(), null);
queryEngine.setActiveSkill('database-sql-optimizer');
assert.strictEqual(queryEngine.getActiveSkill(), 'database-sql-optimizer');
queryEngine.setActiveSkill(null);
assert.strictEqual(queryEngine.getActiveSkill(), null);
console.log('[PASS] QueryEngine skill state management verified.');

// =========================================================================
// TEST 4: ClaudeAgentRoles & SubagentTool Extended Roles
// =========================================================================
console.log('\n--- Test 4: ClaudeAgentRoles & SubagentTool Extended Roles ---');
const newRoles: ClaudeAgentRoleType[] = ['architect', 'coder', 'reviewer', 'tester', 'profiler'];
for (const r of newRoles) {
  const roleDef = getClaudeAgentRole(r);
  assert.ok(roleDef, `Role "${r}" must exist in CLAUDE_AGENT_ROLES`);
  assert.ok(roleDef.systemPrompt.length > 50, `Role "${r}" must have detailed system prompt`);
  assert.ok(roleDef.allowedTools.length > 0, `Role "${r}" must define allowedTools`);
  console.log(`  [PASS] Role [${r.toUpperCase()}]: ${roleDef.name} - Allowed Tools: [${roleDef.allowedTools.join(', ')}]`);
}

const subagentTool = new SubagentTool();
for (const r of newRoles) {
  const result = await subagentTool.execute(
    {
      taskGoal: `Verify ${r} functionality`,
      agentRole: r,
      workerName: `unit-worker-${r}`,
    },
    mockContext
  );
  assert.ok(result.includes(`[${r.toUpperCase()} AGENT TASK COMPLETED]`), `Result must acknowledge role ${r}`);
  assert.ok(result.includes(`unit-worker-${r}`), `Result must contain worker id`);
  console.log(`  [PASS] SubagentTool dispatch test passed for role: ${r}`);
}

// =========================================================================
// TEST 5: CLI /skills Command Subcommands
// =========================================================================
console.log('\n--- Test 5: CLI /skills Command Subcommands ---');

// 5a. /skills list
const listOutput = await skillsCommand.execute({
  cwd: rootDir,
  sessionState: {},
  args: ['list'],
});
assert.ok(listOutput.includes('InterShader Integrated Skills Ecosystem'), 'List command must have header');
assert.ok(listOutput.includes('fullstack-web-architect'), 'List command must include fullstack-web-architect');
assert.ok(listOutput.includes('database-sql-optimizer'), 'List command must include database-sql-optimizer');
console.log('  [PASS] /skills list executed successfully.');

// 5b. /skills info <name>
const infoOutput = await skillsCommand.execute({
  cwd: rootDir,
  sessionState: {},
  args: ['info', 'database-sql-optimizer'],
});
assert.ok(infoOutput.includes('Skill Specification: database-sql-optimizer'), 'Info command must display skill spec');
assert.ok(infoOutput.includes('Tier:         builtin'), 'Info command must display tier');
assert.ok(infoOutput.includes('SHA-256:'), 'Info command must display content hash');
console.log('  [PASS] /skills info database-sql-optimizer executed successfully.');

// 5c. /skills activate <name>
const sessionState: Record<string, unknown> = {};
const activateOutput = await skillsCommand.execute({
  cwd: rootDir,
  sessionState,
  args: ['activate', 'python-advanced-engineer'],
});
assert.ok(activateOutput.includes('Skill Activated: [python-advanced-engineer]'), 'Activate output must confirm');
assert.strictEqual(sessionState.activeSkill, 'python-advanced-engineer', 'Session state activeSkill must be updated');
console.log('  [PASS] /skills activate python-advanced-engineer executed successfully.');

// 5d. /skills audit (All skills)
const auditOutput = await skillsCommand.execute({
  cwd: rootDir,
  sessionState: {},
  args: ['audit'],
});
assert.ok(auditOutput.includes('PASSED'), 'Audit output must report PASSED status');
assert.ok(!auditOutput.includes('[FAIL: CRITICAL]'), 'No skill should have CRITICAL failure');
assert.ok(!auditOutput.includes('[FAIL: HIGH]'), 'No skill should have HIGH failure');
console.log('  [PASS] /skills audit on all skills completed with 0 failures.');

console.log('\n=================================================================');
console.log('ALL ADVANCED AGENT & 12-SKILL SUITE TESTS PASSED (100% GREEN)');
console.log('=================================================================\n');
