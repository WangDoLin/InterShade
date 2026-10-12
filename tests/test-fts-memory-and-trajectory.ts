import assert from 'assert';
import { randomUUID } from 'crypto';
import { FtsMemoryService } from '../services/memory/FtsMemoryService.js';
import { TrajectoryRecorder } from '../services/memory/TrajectoryRecorder.js';
import { MemorySearchTool } from '../tools/search/MemorySearchTool.js';

console.log('[TEST]: Starting FTS5 Memory Engine & Trajectory Recorder verification...');

const testProjectId = `proj-${randomUUID().slice(0, 8)}`;
const testSessionId = `sess-${randomUUID().slice(0, 8)}`;

// 1. Verify inserting data into FTS5 Memory
const mem1 = FtsMemoryService.recordMemory({
  projectId: testProjectId,
  sessionId: testSessionId,
  type: 'architecture',
  title: 'SQLite FTS5 Full-Text Search Engine',
  content: 'Uses memories_fts virtual table for ultra-fast BM25 full-text search under 5ms.',
});
assert.ok(mem1.id);

const mem2 = FtsMemoryService.recordMemory({
  projectId: testProjectId,
  sessionId: testSessionId,
  type: 'lesson',
  title: 'Preimage WAL Rollback Invariant',
  content: 'Always store pristine pre-image before applying patches for immediate rollback if tests fail.',
});
assert.ok(mem2.id);

const mem3 = FtsMemoryService.recordMemory({
  projectId: testProjectId,
  sessionId: testSessionId,
  type: 'bug_pattern',
  title: 'Zero Turn Batch Buffer Leak',
  content: 'Flush buffer after every transaction batch to prevent heap memory exhaustion.',
});
assert.ok(mem3.id);
console.log('[PASS]: Inserted records into FTS5 Memory successfully');

// 2. Verify BM25 search on FTS5
const ftsResults = FtsMemoryService.searchMemories('FTS5 BM25', { projectId: testProjectId });
assert.ok(ftsResults.length >= 1);
assert.strictEqual(ftsResults[0].id, mem1.id);
assert.ok(ftsResults[0].snippet.includes('**'));
console.log(`[PASS]: FTS5 BM25 search successful (Found ${ftsResults.length} matches, Rank: ${ftsResults[0].rank})`);

const rollbackResults = FtsMemoryService.searchMemories('Rollback', { projectId: testProjectId });
assert.ok(rollbackResults.length >= 1);
assert.strictEqual(rollbackResults[0].id, mem2.id);
console.log('[PASS]: Search by Rollback keyword successful');

// 3. Verify LLM context formatting
const formatted = FtsMemoryService.formatMemoriesForContext(testProjectId, 'SQLite FTS5');
assert.ok(formatted.includes('SQLite FTS5 Full-Text Search Engine'));
console.log('[PASS]: Formatted Context Markdown from FTS5 successfully');

// 4. Verify TrajectoryRecorder
const trajSuccess = TrajectoryRecorder.recordTrajectory({
  sessionId: testSessionId,
  taskId: 'task-001',
  intent: 'Fix SQLite memory leak',
  prompt: 'Please fix memory leak in SQLite WAL',
  stagesExecuted: ['IntentScope', 'Recon', 'RedRepro', 'RootCause', 'Plan', 'Patch', 'Apply', 'GreenVerify', 'Audit', 'Cleanup'],
  changedFiles: ['state/Database.ts'],
  status: 'SUCCESS',
  diffStat: '+15 -2',
  reproEvidence: 'Memory usage dropped by 40MB',
  tokensUsed: 1250,
  durationMs: 3400,
});
assert.ok(trajSuccess.id);

const trajFail = TrajectoryRecorder.recordTrajectory({
  sessionId: testSessionId,
  taskId: 'task-002',
  intent: 'Refactor parser',
  prompt: 'Refactor AST parser',
  stagesExecuted: ['IntentScope', 'Recon', 'RedRepro'],
  changedFiles: ['parser.ts'],
  status: 'ROLLED_BACK',
  reproEvidence: 'Syntax error in fixture',
  tokensUsed: 400,
  durationMs: 1200,
});
assert.ok(trajFail.id);

const sessionTrajs = TrajectoryRecorder.getTrajectoriesForSession(testSessionId);
assert.strictEqual(sessionTrajs.length, 2);

const successfulTrajs = TrajectoryRecorder.getRecentSuccessful(5);
assert.ok(successfulTrajs.length >= 1);
assert.ok(successfulTrajs.every((t) => t.status === 'SUCCESS'));
console.log('[PASS]: TrajectoryRecorder saved and queried trajectories successfully');

// 5. Verify MemorySearchTool
async function testTool() {
  const tool = new MemorySearchTool();
  const output = await tool.execute(
    { query: 'Rollback Invariant', limit: 2 },
    { cwd: process.cwd(), sessionId: testSessionId, permissionMode: 'auto' }
  );
  assert.ok(output.includes('Preimage WAL Rollback Invariant'));
  assert.ok(output.includes('Score:'));
  console.log('[PASS]: MemorySearchTool executed successfully');
}

testTool().then(() => {
  console.log('[SUCCESS]: ALL STEP 1 TESTS (FTS5 & TRAJECTORY) PASSED 100%!');
});
