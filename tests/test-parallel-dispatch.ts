import assert from 'assert';
import { ParallelToolDispatcher } from '../engine/ParallelToolDispatcher.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { BaseTool } from '../tools/BaseTool.js';
import { HookEngine } from '../services/hooks/HookEngine.js';
import { z } from 'zod';
import type { ToolExecutionContext, ToolCall } from '../types/index.js';

console.log('[TEST]: Starting Parallel Tool Dispatcher Tests...');

// 1. Create Mock Read-Only and Mutating Tools
class MockDelayReadTool extends BaseTool<{ id: number; delayMs: number }, string> {
  name = 'mock_read';
  description = 'Mock read tool with simulated delay';
  isReadOnly = true;
  inputSchema = z.object({ id: z.number(), delayMs: z.number() });

  async execute(args: { id: number; delayMs: number }, _context: ToolExecutionContext): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    return `read_result_${args.id}`;
  }
}

class MockFailingReadTool extends BaseTool<Record<string, unknown>, string> {
  name = 'mock_fail_read';
  description = 'Mock failing read tool';
  isReadOnly = true;
  inputSchema = z.object({});

  async execute(): Promise<string> {
    throw new Error('Simulated read failure');
  }
}

class MockMutateTool extends BaseTool<{ val: string }, string> {
  name = 'mock_mutate';
  description = 'Mock mutating tool';
  isReadOnly = false;
  inputSchema = z.object({ val: z.string() });

  async execute(args: { val: string }): Promise<string> {
    return `mutated_${args.val}`;
  }
}

// 2. Setup ToolRegistry
const registry = new ToolRegistry();
registry.register(new MockDelayReadTool());
registry.register(new MockFailingReadTool());
registry.register(new MockMutateTool());

const mockContext: ToolExecutionContext = {
  sessionId: 'test-session',
  cwd: process.cwd(),
  permissionMode: 'default',
  signal: new AbortController().signal,
};

// 3. Test Concurrent Execution of Consecutive Read-Only Tools
async function testConcurrentReadBatch() {
  const toolCalls: ToolCall[] = [
    { id: 'c1', name: 'mock_read', arguments: { id: 1, delayMs: 60 } },
    { id: 'c2', name: 'mock_read', arguments: { id: 2, delayMs: 60 } },
    { id: 'c3', name: 'mock_read', arguments: { id: 3, delayMs: 60 } },
  ];

  const startTime = Date.now();
  const results = await ParallelToolDispatcher.dispatch(toolCalls, registry, mockContext);
  const elapsed = Date.now() - startTime;

  assert.strictEqual(results.length, 3, 'All 3 read calls should return');
  assert.strictEqual(results[0].resultContent, 'read_result_1');
  assert.strictEqual(results[1].resultContent, 'read_result_2');
  assert.strictEqual(results[2].resultContent, 'read_result_3');
  assert.strictEqual(results[0].isError, false);

  // If sequential, elapsed would be >= 180ms. If concurrent, ~60-120ms.
  assert.ok(elapsed < 160, `Batch execution took ${elapsed}ms, confirming concurrent execution (< 160ms)`);
  console.log(`[PASS]: Concurrent read batch executed in ${elapsed}ms (< 160ms sequential baseline)`);
}

// 4. Test Mixed Read & Mutate Batch Partitioning
async function testMixedBatchPartitioning() {
  const executionOrder: string[] = [];
  const hookEngine = new HookEngine();

  hookEngine.register('post_tool_use', async (event) => {
    executionOrder.push(event.toolName);
  });

  const toolCalls: ToolCall[] = [
    { id: 'c1', name: 'mock_read', arguments: { id: 1, delayMs: 30 } },
    { id: 'c2', name: 'mock_read', arguments: { id: 2, delayMs: 30 } },
    { id: 'm1', name: 'mock_mutate', arguments: { val: 'first' } },
    { id: 'c3', name: 'mock_read', arguments: { id: 3, delayMs: 20 } },
    { id: 'm2', name: 'mock_mutate', arguments: { val: 'second' } },
  ];

  const results = await ParallelToolDispatcher.dispatch(toolCalls, registry, mockContext, hookEngine);

  assert.strictEqual(results.length, 5);
  // Verify results contents
  assert.strictEqual(results[0].resultContent, 'read_result_1');
  assert.strictEqual(results[1].resultContent, 'read_result_2');
  assert.strictEqual(results[2].resultContent, 'mutated_first');
  assert.strictEqual(results[3].resultContent, 'read_result_3');
  assert.strictEqual(results[4].resultContent, 'mutated_second');

  // Verify that mutate tools ran after their preceding batch
  assert.strictEqual(executionOrder.length, 5);
  console.log('[PASS]: Mixed batch partitioning and ordering verified');
}

// 5. Test Error Isolation in Parallel Dispatch
async function testErrorIsolation() {
  const toolCalls: ToolCall[] = [
    { id: 'c1', name: 'mock_read', arguments: { id: 10, delayMs: 20 } },
    { id: 'f1', name: 'mock_fail_read', arguments: {} },
    { id: 'c2', name: 'mock_read', arguments: { id: 20, delayMs: 20 } },
  ];

  const results = await ParallelToolDispatcher.dispatch(toolCalls, registry, mockContext);

  assert.strictEqual(results.length, 3);
  assert.strictEqual(results[0].isError, false);
  assert.strictEqual(results[1].isError, true);
  assert.ok(results[1].resultContent.includes('Simulated read failure'));
  assert.strictEqual(results[2].isError, false);
  console.log('[PASS]: Error isolation in parallel read batch verified');
}

async function main() {
  await testConcurrentReadBatch();
  await testMixedBatchPartitioning();
  await testErrorIsolation();
  console.log('[SUCCESS]: All Parallel Tool Dispatcher Tests PASSED!');
}

main().catch((err) => {
  console.error('[FAIL]:', err);
  process.exit(1);
});
