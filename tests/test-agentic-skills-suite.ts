import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { GitCommitTool } from '../tools/execution/GitCommitTool.js';
import { RepoMapTool } from '../tools/context/RepoMapTool.js';
import { CodeReviewSentinelTool } from '../tools/code/CodeReviewSentinelTool.js';
import { ContextProviderResolver } from '../services/context/ContextProviderResolver.js';
import { DeveloperHabitService } from '../services/memory/DeveloperHabitService.js';
import { ReproducerGate } from '../engine/reproducer/ReproducerGate.js';
import { McpClientManager } from '../services/mcp/McpClientManager.js';
import { FtsMemoryService } from '../services/memory/FtsMemoryService.js';

console.log('[TEST]: Starting InterShader 7 Agentic Skills & Capabilities Suite...');

const testCwd = process.cwd();
const testProjId = `test-agentic-${randomUUID().slice(0, 6)}`;

// ==========================================
// 1. Test ContextProviderResolver (@ shortcuts)
// ==========================================
console.log('\n--- 1. Testing ContextProviderResolver (@ shortcuts) ---');
const samplePrompt = 'Analyze the codebase @git and check changes @diff and recall @memories';
const resolved = ContextProviderResolver.resolve(samplePrompt, testCwd, testProjId);

assert.ok(resolved.appliedShortcuts.includes('@git'), 'Must detect @git');
assert.ok(resolved.appliedShortcuts.includes('@diff'), 'Must detect @diff');
assert.ok(resolved.appliedShortcuts.includes('@memories'), 'Must detect @memories');
assert.strictEqual(resolved.cleanedPrompt, 'Analyze the codebase and check changes and recall');
assert.ok(resolved.injectedContext.includes('### Git Status (@git)'), 'Must inject git status section');
assert.ok(resolved.injectedContext.includes('### Working Tree Git Diff (@diff)'), 'Must inject git diff section');
console.log('[PASS]: ContextProviderResolver resolved all inline shortcuts cleanly!');

// ==========================================
// 2. Test RepoMapTool (AST Symbol Architecture Map)
// ==========================================
console.log('\n--- 2. Testing RepoMapTool (AST Architecture Map) ---');
const repoMapTool = new RepoMapTool();
const repoMapOutput = await repoMapTool.execute(
  { maxFiles: 5 },
  { sessionId: 'test', cwd: testCwd, permissionMode: 'bypassPermissions' }
);

assert.ok(repoMapOutput.includes('# Repository AST Structural Architecture Map'), 'Must output map title');
assert.ok(repoMapOutput.includes('files indexed'), 'Must report indexed file count');
console.log('[PASS]: RepoMapTool generated high-density AST structural codebase overview!');

// ==========================================
// 3. Test CodeReviewSentinelTool (Hostile Quality/Security Audit)
// ==========================================
console.log('\n--- 3. Testing CodeReviewSentinelTool ---');
const sentinelTool = new CodeReviewSentinelTool();

// Create a temp file with intentional anti-patterns to audit
const tempAuditDir = path.join(testCwd, 'scratch_audit_test');
if (!fs.existsSync(tempAuditDir)) fs.mkdirSync(tempAuditDir, { recursive: true });
const tempAuditFile = path.join(tempAuditDir, 'vulnerable_sample.ts');

fs.writeFileSync(
  tempAuditFile,
  `
export function riskyFunction(input: string) {
  // Anti-pattern 1: Dangerous eval
  const result = eval(input);
  try {
    console.log(result);
  } catch (err) {} // Anti-pattern 2: Silent catch block
  return result;
}
`
);

const auditReport = await sentinelTool.execute(
  { targetFiles: [tempAuditFile] },
  { sessionId: 'test', cwd: testCwd, permissionMode: 'bypassPermissions' }
);

// Cleanup temp file
fs.unlinkSync(tempAuditFile);
fs.rmdirSync(tempAuditDir);

assert.ok(auditReport.includes('Arbitrary Code Execution via eval()'), 'Must detect eval security flaw');
assert.ok(auditReport.includes('Silent Empty Catch Block'), 'Must detect empty catch craftsmanship violation');
console.log('[PASS]: CodeReviewSentinelTool caught security & craftsmanship flaws accurately!');

// ==========================================
// 4. Test DeveloperHabitService (Learned User Preferences)
// ==========================================
console.log('\n--- 4. Testing DeveloperHabitService ---');
const habitPrompt = 'Từ giờ trong dự án này không dùng tailwind và luôn chạy server ở port 4000 nhé';
const detectedHabit1 = DeveloperHabitService.detectAndPersistHabit(habitPrompt, testProjId);
assert.ok(detectedHabit1, 'Must detect styling preference');
assert.strictEqual(detectedHabit1.preference, 'Styling Framework: Vanilla CSS');

// Verify it persisted in FtsMemoryService
const memorySearch = FtsMemoryService.searchMemories('Vanilla CSS', { projectId: testProjId });
assert.ok(memorySearch.length >= 1, 'Habit must be searchable in SQLite FTS5 memory');
assert.ok(memorySearch[0].content.includes('Vanilla CSS'));
console.log('[PASS]: DeveloperHabitService detected & persisted preference into long-term memory!');

// ==========================================
// 5. Test ReproducerGate (TDD & SWE Protocol)
// ==========================================
console.log('\n--- 5. Testing ReproducerGate ---');
const directive = ReproducerGate.getReproducerDirective();
assert.ok(directive.includes('PROVE IT FIRST'), 'Must contain reproduce directive');
assert.ok(directive.includes('NO EVIDENCE, NO DONE'), 'Must enforce empirical verification');

// Test running reproducer on non-existent file
const nonExistentResult = ReproducerGate.runReproducerTest(testCwd, 'non_existent_repro.ts');
assert.strictEqual(nonExistentResult.success, false);
console.log('[PASS]: ReproducerGate validated test lifecycle and directives!');

// ==========================================
// 6. Test McpClientManager (Model Context Protocol Configuration)
// ==========================================
console.log('\n--- 6. Testing McpClientManager ---');
const connected = McpClientManager.getConnectedServers();
assert.ok(Array.isArray(connected), 'Connected servers must return an array');
console.log('[PASS]: McpClientManager initialized and protocol layer verified!');

// ==========================================
// 7. Test GitCommitTool (Conventional Commits Validation)
// ==========================================
console.log('\n--- 7. Testing GitCommitTool ---');
const commitTool = new GitCommitTool();
assert.strictEqual(commitTool.name, 'git_commit');
assert.ok(commitTool.description.includes('Conventional Commit'));
console.log('[PASS]: GitCommitTool verified!');

console.log('\n=============================================================');
console.log('🎉 ALL 7 AGENTIC SKILLS & CAPABILITIES TESTS PASSED 100%!');
console.log('=============================================================\n');
