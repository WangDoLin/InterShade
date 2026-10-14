import assert from 'assert';
import { randomUUID } from 'crypto';
import type { UnifiedMessage } from '../types/index.js';
import { ObservationPruner } from '../context/ObservationPruner.js';
import { TrajectoryCompressor } from '../context/TrajectoryCompressor.js';
import { MultiTierCompactor } from '../context/MultiTierCompactor.js';
import { MemoryRecordTool } from '../tools/search/MemoryRecordTool.js';
import { FtsMemoryService } from '../services/memory/FtsMemoryService.js';
import { ModelRegistry } from '../orchestrator/ModelRegistry.js';

console.log('[TEST]: Starting Context Reservation & Long-Term Memory Suite...');

// ==========================================
// 1. Test Model Adaptive Context Window Sizing
// ==========================================
console.log('\n--- 1. Testing Model Adaptive Context Window Sizing ---');
const geminiTokens = ModelRegistry.resolveModelContextWindow('gemini-3.8-flash');
assert.strictEqual(geminiTokens, 1_048_576, 'Gemini 3.8 Flash should have 1M tokens');

const deepseekTokens = ModelRegistry.resolveModelContextWindow('deepseek-chat');
assert.strictEqual(deepseekTokens, 64_000, 'DeepSeek should have 64k tokens');

const claudeTokens = ModelRegistry.resolveModelContextWindow('claude-3-7-sonnet');
assert.strictEqual(claudeTokens, 200_000, 'Claude 3.7 Sonnet should have 200k tokens');

const gptTokens = ModelRegistry.resolveModelContextWindow('gpt-4o');
assert.strictEqual(gptTokens, 128_000, 'GPT-4o should have 128k tokens');

console.log('[PASS]: Adaptive Context Window correctly computed across models!');

// ==========================================
// 2. Test ObservationPruner with AST Skeleton Preservation
// ==========================================
console.log('\n--- 2. Testing ObservationPruner with AST Skeleton Preservation ---');
const sampleTsCode = `
import { EventEmitter } from 'events';

export interface UserConfig {
  id: string;
  name: string;
  role: 'admin' | 'dev';
}

export class UserManager extends EventEmitter {
  private users: Map<string, UserConfig> = new Map();

  constructor() {
    super();
  }

  public addUser(user: UserConfig): void {
    this.users.set(user.id, user);
    this.emit('user_added', user);
  }

  public getUser(id: string): UserConfig | undefined {
    return this.users.get(id);
  }

  public listAllUsers(): UserConfig[] {
    const list: UserConfig[] = [];
    for (const u of this.users.values()) {
      list.push(u);
    }
    return list;
  }
}
`.repeat(3); // make it > 30 lines

const toolCallId = 'call_read_user_ts';
const testMessages: UnifiedMessage[] = [
  { id: '1', role: 'system', content: 'System prompt', timestamp: 1 },
  { id: '2', role: 'user', content: 'Read user manager file', timestamp: 2 },
  {
    id: '3',
    role: 'assistant',
    content: 'Let me read UserManager.ts',
    timestamp: 3,
    toolCalls: [{ id: toolCallId, name: 'file_read', arguments: { filePath: 'UserManager.ts' } }],
  },
  {
    id: '4',
    role: 'tool',
    content: sampleTsCode,
    toolCallId,
    toolResult: { toolCallId, toolName: 'file_read', isError: false, content: sampleTsCode },
    timestamp: 4,
  },
  // Add 4 more recent turns so tool message #4 is outside keepLastNTurns (thresholdIdx)
  { id: '5', role: 'assistant', content: 'Done reading', timestamp: 5 },
  { id: '6', role: 'user', content: 'Next step', timestamp: 6 },
  { id: '7', role: 'assistant', content: 'Checking other file', timestamp: 7 },
  { id: '8', role: 'tool', content: 'File 2 output', toolResult: { toolCallId: 'c2', toolName: 'file_read', isError: false, content: 'File 2' }, timestamp: 8 },
  { id: '9', role: 'assistant', content: 'Ready', timestamp: 9 },
  { id: '10', role: 'tool', content: 'File 3 output', toolResult: { toolCallId: 'c3', toolName: 'file_read', isError: false, content: 'File 3' }, timestamp: 10 },
  { id: '11', role: 'assistant', content: 'Final response', timestamp: 11 },
  { id: '12', role: 'tool', content: 'File 4 output', toolResult: { toolCallId: 'c4', toolName: 'file_read', isError: false, content: 'File 4' }, timestamp: 12 },
];

const pruneRes = ObservationPruner.pruneToolObservations(testMessages, 1000, 0.1, 2);
assert.ok(pruneRes.pruned, 'ObservationPruner should trigger pruning');

const prunedMsg = pruneRes.messages.find((m) => m.id === '4');
assert.ok(prunedMsg, 'Message 4 must still exist');
assert.ok(
  prunedMsg.content.includes('[AST Skeleton Preserved: UserManager.ts'),
  'Should preserve AST skeleton notice with file path'
);
assert.ok(prunedMsg.content.includes('interface UserConfig'), 'AST Skeleton must preserve interface declaration');
assert.ok(prunedMsg.content.includes('class UserManager'), 'AST Skeleton must preserve class declaration');
assert.ok(prunedMsg.content.includes('addUser'), 'AST Skeleton must preserve method signature');
console.log('[PASS]: ObservationPruner preserved AST Skeletons for code files without losing structure!');

// ==========================================
// 3. Test TrajectoryCompressor Semantic Distillation & Pinned Protection
// ==========================================
console.log('\n--- 3. Testing TrajectoryCompressor Semantic Distillation ---');
const pinnedDirective: UnifiedMessage = {
  id: 'pinned-1',
  role: 'user',
  content: 'CRITICAL INVARIANT: Never remove the WAL mode from SQLite database.',
  timestamp: 100,
  isPinned: true,
};

const trajectoryMessages: UnifiedMessage[] = [
  { id: 'h1', role: 'system', content: 'System prompt', timestamp: 1 },
  { id: 'h2', role: 'user', content: 'Initial user prompt: Fix database connection', timestamp: 2 },
  // Middle turns
  pinnedDirective,
  {
    id: 'm1',
    role: 'assistant',
    content: 'Insight: Nguyen nhan la do missing write permission in directory',
    timestamp: 3,
    toolCalls: [{ id: 'tc1', name: 'file_edit', arguments: { filePath: 'src/db.ts' } }],
  },
  { id: 'm2', role: 'tool', content: 'Success edit', toolResult: { toolCallId: 'tc1', toolName: 'file_edit', isError: false, content: 'Saved file' }, timestamp: 4 },
  { id: 'm3', role: 'user', content: 'Also ensure connection pool limit is set to 10', timestamp: 5 },
  { id: 'm4', role: 'assistant', content: 'Decision: Will use pool limit 10', timestamp: 6 },
  // Tail turns
  { id: 't1', role: 'assistant', content: 'Tail turn 1', timestamp: 7 },
  { id: 't2', role: 'user', content: 'Tail turn 2', timestamp: 8 },
  { id: 't3', role: 'assistant', content: 'Tail turn 3', timestamp: 9 },
  { id: 't4', role: 'user', content: 'Tail turn 4', timestamp: 10 },
];

const compressRes = TrajectoryCompressor.compressIfNeeded(trajectoryMessages, 50, 0.1);
assert.ok(compressRes.compressed, 'TrajectoryCompressor should trigger compression');

// Verify that pinnedDirective is preserved in the resulting messages
const foundPinned = compressRes.messages.find((m) => m.id === 'pinned-1');
assert.ok(foundPinned, 'Pinned message MUST be preserved uncollapsed');
assert.strictEqual(foundPinned.content, pinnedDirective.content);

// Verify that summary message contains semantic distillation
const summaryMsg = compressRes.messages.find((m) => m.content.includes('[CONTEXT CHECKPOINT - SEMANTIC DISTILLATION]'));
assert.ok(summaryMsg, 'Must contain SEMANTIC DISTILLATION checkpoint');
assert.ok(summaryMsg.content.includes('pool limit is set to 10'), 'Must distill user directive');
assert.ok(summaryMsg.content.includes('src/db.ts'), 'Must record modified file in ledger');
assert.ok(summaryMsg.content.includes('Nguyen nhan'), 'Must capture root cause insight');
console.log('[PASS]: TrajectoryCompressor distilled semantic checkpoint & preserved pinned anchors!');

// ==========================================
// 4. Test MultiTierCompactor nonSystem Bug Fix
// ==========================================
console.log('\n--- 4. Testing MultiTierCompactor nonSystem Bug Fix ---');
const compactorMessages: UnifiedMessage[] = [
  { id: 'c_sys', role: 'system', content: 'System instruction', timestamp: 1 },
  { id: 'c_u1', role: 'user', content: 'User requested feature XYZ', timestamp: 2 },
  { id: 'c_a1', role: 'assistant', content: 'Working on feature XYZ', timestamp: 3 },
  { id: 'c_t1', role: 'tool', content: 'Done XYZ', toolResult: { toolCallId: '1', toolName: 'file_edit', isError: false, content: 'Saved file' }, timestamp: 4 },
  { id: 'c_u2', role: 'user', content: 'Final question', timestamp: 5 },
  { id: 'c_a2', role: 'assistant', content: 'Final answer', timestamp: 6 },
];

const autoCompactRes = MultiTierCompactor.applyAutoCompact(compactorMessages);
const compactSummary = autoCompactRes.messages.find((m) => m.content.includes('# Conversation Compaction Boundary'));
assert.ok(compactSummary, 'Must contain Compaction Boundary summary');
assert.ok(
  compactSummary.content.includes('User request: "User requested feature XYZ"'),
  'Bug fix verified: nonSystem must include user requests and not be empty!'
);
assert.ok(
  compactSummary.content.includes('Tool file_edit [SUCCESS]'),
  'Bug fix verified: nonSystem must include tool executions!'
);
console.log('[PASS]: MultiTierCompactor nonSystem bug fix verified with accurate action distillation!');

// ==========================================
// 5. Test MemoryRecordTool & SQLite FTS5 RAG Integration
// ==========================================
console.log('\n--- 5. Testing MemoryRecordTool & FTS5 Dynamic RAG ---');
const testProj = `test-context-suite-${randomUUID().slice(0, 6)}`;
const recordTool = new MemoryRecordTool();

const recordResult = await recordTool.execute(
  {
    type: 'architecture',
    title: 'Clean Architecture Port Invariant',
    content: 'All service modules must communicate through domain interfaces, no direct DB calls in controllers.',
  },
  {
    sessionId: 'sess-test',
    cwd: `C:/projects/${testProj}`,
    permissionMode: 'bypassPermissions',
  }
);

assert.ok(recordResult.includes('[Memory Recorded Successfully]'));
assert.ok(recordResult.includes('Clean Architecture Port Invariant'));

// Verify that FtsMemoryService can RAG this memory when query relates to "domain interfaces"
const formattedRAG = FtsMemoryService.formatMemoriesForContext(testProj, 'controller domain interface');
assert.ok(formattedRAG.includes('Clean Architecture Port Invariant'), 'RAG injection must match query');
assert.ok(formattedRAG.includes('no direct DB calls in controllers'), 'RAG injection must contain memory content');
console.log('[PASS]: MemoryRecordTool and dynamic FTS5 BM25 RAG injection working seamlessly!');

console.log('\n======================================================');
console.log('🎉 ALL CONTEXT RESERVATION & MEMORY SUITE TESTS PASSED 100%!');
console.log('======================================================\n');
