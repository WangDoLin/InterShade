import { tasksCommand, interviewCommand, lintCommand } from '../cli/commands/builtinCommands.js';
import { TaskManager } from '../state/TaskManager.js';
import { SessionStore } from '../state/SessionStore.js';
import path from 'path';
import fs from 'fs';

async function runTests() {
  console.log('--- TEST: New Developer Slash Commands (/tasks, /interview, /lint) ---');

  const testSessionId = `test-cmds-${Date.now()}`;
  SessionStore.createSession({
    sessionId: testSessionId,
    cwd: process.cwd(),
    model: 'test',
    provider: 'test',
    maxTokens: 4000,
    permissionMode: 'bypassPermissions',
  });

  // Test 1: /tasks command with empty session
  console.log('1. Testing /tasks with no tasks...');
  const emptyOutput = await tasksCommand.execute({
    args: [],
    sessionState: { id: testSessionId },
    cwd: process.cwd(),
  });

  if (!emptyOutput.includes('No tasks currently registered')) {
    throw new Error(`Unexpected /tasks output on empty session: ${emptyOutput}`);
  }
  console.log(`[PASS] Empty /tasks verified.`);

  // Create tasks and test /tasks output
  const t1 = TaskManager.createTask(testSessionId, {
    subject: 'Refactor QueryEngine',
    description: 'Add askQuestion pipeline',
  });
  const t2 = TaskManager.createTask(testSessionId, {
    subject: 'Build QuestionPrompt Ink component',
    description: 'Interactive radio select and text write-in',
    activeForm: 'Building component...',
  });
  TaskManager.updateTask(testSessionId, t1.id, { status: 'completed' });
  TaskManager.updateTask(testSessionId, t2.id, { status: 'in_progress' });

  const tasksOutput = await tasksCommand.execute({
    args: [],
    sessionState: { id: testSessionId },
    cwd: process.cwd(),
  });

  if (!tasksOutput.includes(`[✔] #${t1.id}: Refactor QueryEngine`) || !tasksOutput.includes(`[▶] #${t2.id}: Build QuestionPrompt`)) {
    throw new Error(`Unexpected /tasks output:\n${tasksOutput}`);
  }
  console.log(`[PASS] /tasks list verified:\n${tasksOutput}`);

  // Test 2: /interview command
  console.log('2. Testing /interview prompt generation...');
  const prompt = await interviewCommand.getPrompt({
    args: ['multi-tenant JWT authentication'],
    sessionState: { id: testSessionId },
    cwd: process.cwd(),
  });

  if (!prompt.includes('Socratic clarification interview') || !prompt.includes('multi-tenant JWT authentication')) {
    throw new Error(`Unexpected /interview prompt: ${prompt}`);
  }
  console.log(`[PASS] /interview prompt verified.`);

  // Test 3: /lint command on clean file and error detection
  console.log('3. Testing /lint command on clean file and error detection...');
  const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  const cleanFile = path.join(fixturesDir, 'lint-clean.ts');
  fs.writeFileSync(cleanFile, 'export function multiply(a: number, b: number): number {\n  return a * b;\n}\n', 'utf-8');

  const lintOutput = await lintCommand.execute({
    args: ['tests/fixtures/lint-clean.ts'],
    sessionState: { id: testSessionId },
    cwd: process.cwd(),
  });

  if (!lintOutput.includes('[LINT]: No errors or warnings found')) {
    throw new Error(`Unexpected /lint output for clean file: ${lintOutput}`);
  }
  console.log(`[PASS] /lint command clean file verified: ${lintOutput}`);

  // Test 3b: /lint error detection
  const brokenFile = path.join(fixturesDir, 'lint-broken.ts');
  fs.writeFileSync(brokenFile, 'const x: number = "string error";\n', 'utf-8');

  const lintBrokenOutput = await lintCommand.execute({
    args: ['tests/fixtures/lint-broken.ts'],
    sessionState: { id: testSessionId },
    cwd: process.cwd(),
  });

  if (!lintBrokenOutput.includes('issue(s) found in')) {
    throw new Error(`Expected /lint to find issues in broken file, got: ${lintBrokenOutput}`);
  }
  console.log(`[PASS] /lint command issue detection verified: ${lintBrokenOutput.split('\n')[0]}`);

  // Cleanup
  if (fs.existsSync(cleanFile)) fs.unlinkSync(cleanFile);
  if (fs.existsSync(brokenFile)) fs.unlinkSync(brokenFile);
  TaskManager.deleteTask(testSessionId, t1.id);
  TaskManager.deleteTask(testSessionId, t2.id);

  console.log('\nAll New Slash Commands Tests PASSED! [100% SUCCESS]');
}

runTests().catch((err) => {
  console.error('[TEST FAILURE]:', err);
  process.exit(1);
});
