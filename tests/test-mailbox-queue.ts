import assert from 'assert';
import { MailboxQueue } from '../services/agent/MailboxQueue.js';
import { SubagentTool } from '../tools/agentic/SubagentTool.js';
import { SendMessageTool } from '../tools/agentic/SendMessageTool.js';

console.log('[TEST]: Starting Mailbox Queue & Multi-Agent Tests...');

// 1. Direct Enqueue and Receive
const mailbox = new MailboxQueue();
mailbox.enqueue('leader', 'worker-1', 'Task instructions for worker 1');
mailbox.enqueue('leader', 'worker-2', 'Task instructions for worker 2');

assert.strictEqual(mailbox.size(), 2);

// 2. Peek messages
const worker1Peek = mailbox.peek('worker-1');
assert.strictEqual(worker1Peek.length, 1);
assert.strictEqual(worker1Peek[0].content, 'Task instructions for worker 1');
assert.strictEqual(mailbox.size(), 2, 'Peek should not remove messages from queue');
console.log('[PASS]: Direct enqueue and non-destructive peek verified');

// 3. Broadcast Enqueue
mailbox.broadcast('leader', 'All workers sync your branch');
assert.strictEqual(mailbox.size(), 3);

// 4. Worker 1 receives messages (should get its direct message + broadcast)
const worker1Received = mailbox.receive('worker-1');
assert.strictEqual(worker1Received.length, 2, 'worker-1 should receive 1 direct + 1 broadcast');
assert.strictEqual(worker1Received[0].content, 'Task instructions for worker 1');
assert.strictEqual(worker1Received[1].content, 'All workers sync your branch');

// Worker 2 should still have its direct message available
assert.strictEqual(mailbox.size(), 1);
const worker2Received = mailbox.receive('worker-2');
assert.strictEqual(worker2Received.length, 1);
assert.strictEqual(worker2Received[0].content, 'Task instructions for worker 2');
assert.strictEqual(mailbox.size(), 0, 'Mailbox should be empty after all messages consumed');
console.log('[PASS]: Multi-agent routing and broadcast delivery verified');

// 5. Test Tools with Mailbox
const subagentTool = new SubagentTool(mailbox);
const sendMessageTool = new SendMessageTool(mailbox);

const mockCtx = {
  sessionId: 'test-session',
  cwd: process.cwd(),
  permissionMode: 'default' as const,
};

async function testTools() {
  // Send message via tool
  await sendMessageTool.execute({ to: 'worker-a', message: 'Hello Worker A' }, mockCtx);
  assert.strictEqual(mailbox.size(), 1);

  // Spawn background subagent
  const spawnRes = await subagentTool.execute(
    { taskGoal: 'Refactor DB adapter', workerName: 'worker-db', runInBackground: true },
    mockCtx
  );
  assert.ok(spawnRes.includes('BACKGROUND TASK SPAWNED'));

  // Allow async callback
  await new Promise((resolve) => setTimeout(resolve, 80));

  const coordinatorMsgs = mailbox.receive('coordinator');
  assert.ok(coordinatorMsgs.length >= 2, 'Coordinator should receive background start and completion notices');
  console.log('[PASS]: SubagentTool background execution and SendMessageTool Mailbox bridge verified');
}

testTools()
  .then(() => {
    console.log('[SUCCESS]: All Mailbox Queue & Multi-Agent Tests PASSED!');
  })
  .catch((err) => {
    console.error('[FAIL]:', err);
    process.exit(1);
  });
