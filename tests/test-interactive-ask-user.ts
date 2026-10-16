import { AskUserTool } from '../tools/agentic/AskUserTool.js';
import { TaskManager, taskEvents } from '../state/TaskManager.js';
import { SessionStore } from '../state/SessionStore.js';
import type { ToolExecutionContext } from '../types/index.js';

async function runTests() {
  console.log('--- TEST: Interactive Clarification Dialog & Task Events ---');

  // Test 1: AskUserTool with context.askQuestion
  console.log('1. Testing AskUserTool interactive question handling...');
  const askTool = new AskUserTool();

  let capturedQuestion = '';
  let capturedOptions: string[] | undefined = [];

  const mockContext: ToolExecutionContext = {
    sessionId: 'test-ask-session',
    cwd: process.cwd(),
    permissionMode: 'bypassPermissions',
    askQuestion: async (question, options) => {
      capturedQuestion = question;
      capturedOptions = options;
      return 'Option B: Implement JWT authentication';
    },
  };

  const toolOutput = await askTool.execute(
    {
      question: 'Which authentication strategy do you prefer?',
      options: ['Option A: Session cookies', 'Option B: Implement JWT authentication'],
      allowCustomInput: true,
    },
    mockContext
  );

  if (capturedQuestion !== 'Which authentication strategy do you prefer?') {
    throw new Error('Question was not properly passed to askQuestion handler.');
  }

  if (!capturedOptions || capturedOptions.length !== 2) {
    throw new Error('Options were not passed to askQuestion handler.');
  }

  if (!toolOutput.includes('Option B: Implement JWT authentication')) {
    throw new Error(`Expected tool output to contain user answer, got: ${toolOutput}`);
  }
  console.log(`[PASS] AskUserTool interactive response verified: "${toolOutput}"`);

  // Test 2: TaskManager event broadcasting
  console.log('2. Testing TaskManager real-time taskEvents broadcasting...');
  let eventFired = false;
  let eventSessionId = '';

  const testSessionId = `test-sess-${Date.now()}`;
  SessionStore.createSession({
    sessionId: testSessionId,
    cwd: process.cwd(),
    model: 'test',
    provider: 'test',
    maxTokens: 4000,
    permissionMode: 'bypassPermissions',
  });

  const onChange = (sessionId: string) => {
    eventFired = true;
    eventSessionId = sessionId;
  };

  taskEvents.on('change', onChange);

  const created = TaskManager.createTask(testSessionId, {
    subject: 'Write unit tests for authentication',
    description: 'Ensure 100% test coverage',
    activeForm: 'Writing unit tests...',
  });

  if (!eventFired || eventSessionId !== testSessionId) {
    throw new Error('Expected taskEvents to fire change event on createTask.');
  }
  console.log(`[PASS] Task created #${created.id} and event fired for session: ${eventSessionId}`);

  eventFired = false;
  TaskManager.updateTask(testSessionId, created.id, {
    status: 'completed',
  });

  if (!eventFired) {
    throw new Error('Expected taskEvents to fire change event on updateTask.');
  }
  console.log(`[PASS] Task updated to completed and change event fired.`);

  // Cleanup
  TaskManager.deleteTask(testSessionId, created.id);
  taskEvents.off('change', onChange);

  console.log('\nAll Interactive Clarification & Task Event Tests PASSED! [100% SUCCESS]');
}

runTests().catch((err) => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
