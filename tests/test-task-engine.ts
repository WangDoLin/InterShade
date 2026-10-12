import { TaskManager } from '../state/TaskManager.js';
import { TaskGraph } from '../tasks/TaskGraph.js';
import { SessionStore } from '../state/SessionStore.js';
import { randomUUID } from 'crypto';

async function main() {
  console.log('=== 1. TESTING TASK DAG & CYCLE DETECTION ===');
  const graph = new TaskGraph();

  graph.addTask({
    id: '1',
    subject: 'Setup database schema',
    description: 'Create SQLite tables',
    status: 'completed',
    blocks: ['2'],
    blockedBy: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  graph.addTask({
    id: '2',
    subject: 'Implement query API',
    description: 'Build backend query logic',
    status: 'in_progress',
    blocks: ['3'],
    blockedBy: ['1'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  graph.addTask({
    id: '3',
    subject: 'Write integration test',
    description: 'Verify query against DB',
    status: 'pending',
    blocks: [],
    blockedBy: ['2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('Graph tasks count:', graph.getAllTasks().length);

  // Test cycle detection
  let cycleDetected = false;
  try {
    graph.addTask({
      id: '4',
      subject: 'Cyclic task',
      description: 'Creates a loop 3 -> 4 -> 1',
      status: 'pending',
      blocks: ['1'],
      blockedBy: ['3'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch (err: any) {
    cycleDetected = true;
    console.log('Cycle caught successfully:', err.message);
  }

  if (!cycleDetected) {
    throw new Error('Failed to detect circular dependency!');
  }

  console.log('\n=== 2. TESTING SQLITE WAL PERSISTENCE & TASK MANAGER ===');
  const testSessionId = randomUUID();
  SessionStore.createSession({
    sessionId: testSessionId,
    provider: 'anthropic',
    model: 'claude-3-7-sonnet-20250219',
    cwd: process.cwd(),
    maxTokens: 8000,
    permissionMode: 'default',
  });

  const taskA = TaskManager.createTask(testSessionId, {
    subject: 'Task A: Scaffold UI components',
    description: 'Build Header, Button, Table',
    activeForm: 'Scaffolding UI components',
  });
  console.log(`Created Task #${taskA.id}: ${taskA.subject}`);

  const taskB = TaskManager.createTask(testSessionId, {
    subject: 'Task B: Connect WebSocket bridge',
    description: 'Establish live RPC connection',
    blockedBy: [taskA.id],
  });
  console.log(`Created Task #${taskB.id}: ${taskB.subject} (blockedBy: #${taskA.id})`);

  const taskC = TaskManager.createTask(testSessionId, {
    subject: 'Task C: Deploy to staging',
    description: 'Ship artifacts to staging environment',
    blockedBy: [taskB.id],
  });
  console.log(`Created Task #${taskC.id}: ${taskC.subject}`);

  // Test status progression
  TaskManager.updateTask(testSessionId, taskA.id, { status: 'completed' });
  TaskManager.updateTask(testSessionId, taskB.id, { status: 'completed' });
  TaskManager.updateTask(testSessionId, taskC.id, { status: 'completed' });

  const graphAfterAllDone = TaskManager.getGraph(testSessionId);
  console.log('Has verification step?:', graphAfterAllDone.hasVerificationStep());
  console.log('Verification Nudge needed?:', graphAfterAllDone.isVerificationNudgeNeeded());

  if (!graphAfterAllDone.isVerificationNudgeNeeded()) {
    throw new Error('Verification nudge should have triggered for 3 non-verification tasks!');
  }

  // Now add verification step
  const taskVerify = TaskManager.createTask(testSessionId, {
    subject: 'Task 4: Run test suite & verify staging',
    description: 'Verify with integration tests',
  });
  TaskManager.updateTask(testSessionId, taskVerify.id, { status: 'completed' });

  const graphWithVerification = TaskManager.getGraph(testSessionId);
  console.log('With test task -> Verification Nudge needed?:', graphWithVerification.isVerificationNudgeNeeded());

  if (graphWithVerification.isVerificationNudgeNeeded()) {
    throw new Error('Verification nudge should NOT trigger once a verification step exists!');
  }

  console.log('\nALL TASK DAG & SQLITE WAL PERSISTENCE TESTS PASSED.');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
