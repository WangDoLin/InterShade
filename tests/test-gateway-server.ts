import assert from 'assert';
import { GatewayServer } from '../gateway/GatewayServer.js';
import { TelegramAdapter } from '../gateway/adapters/TelegramAdapter.js';

console.log('[TEST]: Starting Headless Multi-Channel Gateway Daemon verification...');

const testPort = 3912;
const workspaceDir = process.cwd();
const server = new GatewayServer({ port: testPort, workspaceDir });

async function runTests() {
  // 1. Start Gateway Server
  const port = await server.start();
  assert.strictEqual(port, testPort);
  console.log(`[PASS]: Gateway Server started successfully on port ${port}`);

  // 2. Verify endpoint /api/status
  const statusRes = await fetch(`http://localhost:${testPort}/api/status`);
  assert.strictEqual(statusRes.status, 200);
  const statusData = await statusRes.json();
  assert.strictEqual(statusData.success, true);
  assert.strictEqual(statusData.data.status, 'RUNNING');
  console.log('[PASS]: Endpoint /api/status returned status RUNNING');

  // 3. Verify endpoint /api/skills
  const skillsRes = await fetch(`http://localhost:${testPort}/api/skills`);
  assert.strictEqual(skillsRes.status, 200);
  const skillsData = await skillsRes.json();
  assert.strictEqual(skillsData.success, true);
  assert.ok(Array.isArray(skillsData.skills));
  console.log(`[PASS]: Endpoint /api/skills returned skills catalog (${skillsData.skills.length} skills)`);

  // 4. Verify event dispatch on remote prompt
  let receivedPrompt = '';
  server.on('user_prompt', (msg) => {
    receivedPrompt = msg.prompt;
  });

  const promptRes = await fetch(`http://localhost:${testPort}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'sess-remote-001',
      source: 'telegram',
      prompt: 'Refactor login module',
    }),
  });
  assert.strictEqual(promptRes.status, 200);
  const promptData = await promptRes.json();
  assert.strictEqual(promptData.success, true);
  assert.strictEqual(receivedPrompt, 'Refactor login module');
  console.log('[PASS]: Dispatched remote prompt via REST API successfully');

  // 5. Verify TelegramAdapter
  const tgMsg = TelegramAdapter.formatApprovalRequest(
    123456,
    'task-001',
    'Add OAuth login',
    '+ const token = await auth();'
  );
  assert.strictEqual(tgMsg.chatId, 123456);
  assert.ok(tgMsg.text.includes('InterShader Approval Request'));
  assert.ok(tgMsg.replyMarkup?.inline_keyboard[0][0].callback_data.includes('approve:task-001'));

  const parsedUpdate = TelegramAdapter.parseWebhookUpdate({
    update_id: 1,
    callback_query: {
      id: 'cb-1',
      from: { id: 999, first_name: 'Admin' },
      data: 'approve:task-001',
    },
  });
  assert.strictEqual(parsedUpdate.type, 'callback_query');
  assert.strictEqual(parsedUpdate.action, 'approve:task-001');
  console.log('[PASS]: TelegramAdapter formatted message and parsed webhook successfully');

  // 6. Stop server
  await server.stop();
  console.log('[PASS]: Stopped Gateway Server with graceful shutdown successfully');

  console.log('[SUCCESS]: ALL STEP 6 TESTS (HEADLESS GATEWAY DAEMON) PASSED 100%!');
}

runTests().catch((err) => {
  console.error('[FAIL]:', err);
  process.exit(1);
});
