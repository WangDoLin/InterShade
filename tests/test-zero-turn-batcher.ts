import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ZeroTurnBatcher } from '../engine/ZeroTurnBatcher.js';
import { BatchExecuteTool } from '../tools/execution/BatchExecuteTool.js';
import { SessionStore } from '../state/SessionStore.js';
import type { ToolExecutionContext } from '../types/index.js';

console.log('[TEST]: Starting Zero-Turn Batch RPC Engine verification...');

const cwd = process.cwd();
const testDir = path.join(cwd, '.intershader', 'test-batch');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const file1 = path.join(testDir, 'batch-1.txt');
const file2 = path.join(testDir, 'batch-2.txt');
fs.writeFileSync(file1, 'Alpha content 1\n', 'utf-8');
fs.writeFileSync(file2, 'Beta content 2\n', 'utf-8');

const testSessionId = `sess-batch-${Date.now()}`;
SessionStore.createSession({
  sessionId: testSessionId,
  model: 'claude-3-7-sonnet',
  provider: 'anthropic',
  cwd,
  permissionMode: 'auto',
  maxTokens: 4096,
});

const registry = new ToolRegistry();
const mockContext: ToolExecutionContext = {
  sessionId: testSessionId,
  cwd,
  permissionMode: 'auto',
};

// 1. Verify successful batch execution (Zero-Turn Batch)
async function testSuccessfulBatch() {
  const operations = [
    { id: 'op-read-1', tool: 'file_read', args: { filePath: path.relative(cwd, file1) } },
    { id: 'op-read-2', tool: 'file_read', args: { filePath: path.relative(cwd, file2) } },
    {
      id: 'op-edit-1',
      tool: 'file_edit',
      args: {
        filePath: path.relative(cwd, file1),
        oldString: 'Alpha content 1',
        newString: 'Alpha updated in batch',
      },
    },
  ];

  const summary = await ZeroTurnBatcher.executeBatch(operations, registry, mockContext, true);
  if (summary.succeededCount !== 3) {
    console.error('Batch failed results:', JSON.stringify(summary.results, null, 2));
  }
  assert.strictEqual(summary.totalOperations, 3);
  assert.strictEqual(summary.succeededCount, 3);
  assert.strictEqual(summary.failedCount, 0);
  assert.strictEqual(summary.isAtomicRollback, false);
  assert.ok(summary.estimatedTokensSaved > 5000);

  const updatedContent = fs.readFileSync(file1, 'utf-8');
  assert.ok(updatedContent.includes('Alpha updated in batch'));
  console.log(`[PASS]: Batch successfully executed 3 operations in 1 round (Saved ~${summary.estimatedTokensSaved} tokens)`);
}

// 2. Verify Atomic Rollback when an operation fails
async function testAtomicRollback() {
  const initialContent = fs.readFileSync(file2, 'utf-8');

  const operations = [
    {
      id: 'op-edit-valid',
      tool: 'file_edit',
      args: {
        filePath: path.relative(cwd, file2),
        oldString: 'Beta content 2',
        newString: 'Beta will be rolled back',
      },
    },
    {
      id: 'op-edit-failing',
      tool: 'file_edit',
      args: {
        filePath: path.relative(cwd, file2),
        oldString: 'NON_EXISTENT_CONTENT_TO_TRIGGER_FAILURE',
        newString: 'Never applied',
      },
    },
  ];

  const summary = await ZeroTurnBatcher.executeBatch(operations, registry, mockContext, true);
  assert.strictEqual(summary.failedCount, 1);
  assert.strictEqual(summary.isAtomicRollback, true);

  const contentAfterRollback = fs.readFileSync(file2, 'utf-8');
  assert.strictEqual(contentAfterRollback, initialContent);
  console.log('[PASS]: Atomic Rollback successfully restored files upon operation failure');
}

// 3. Verify BatchExecuteTool execution
async function testToolExecution() {
  const tool = new BatchExecuteTool(registry);
  const output = await tool.execute(
    {
      operations: [
        { id: 'tool-read', tool: 'file_read', args: { filePath: path.relative(cwd, file1) } },
      ],
      atomic: true,
    },
    mockContext
  );

  assert.ok(output.includes('Zero-Turn Batch Execution Summary'));
  assert.ok(output.includes('COMMITTED'));
  console.log('[PASS]: BatchExecuteTool executed successfully via tool interface');
}

async function runAll() {
  try {
    await testSuccessfulBatch();
    await testAtomicRollback();
    await testToolExecution();
    console.log('[SUCCESS]: ALL STEP 4 TESTS (ZERO-TURN BATCH RPC) PASSED 100%!');
  } finally {
    // Cleanup test artifacts
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

runAll();
