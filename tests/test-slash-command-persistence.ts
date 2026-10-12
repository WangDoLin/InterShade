import assert from 'assert';
import { randomUUID } from 'crypto';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { SessionConfig, UnifiedMessage } from '../types/index.js';

console.log('[TEST]: Starting Slash Command Persistence & User Message Notification Test Suite...');

const sessionConfig: SessionConfig = {
  sessionId: randomUUID(),
  provider: 'anthropic',
  model: 'claude-3-7-sonnet-20250219',
  cwd: process.cwd(),
  maxTokens: 160000,
  permissionMode: 'default',
};

const queryEngine = new QueryEngine(sessionConfig);

// 1. Verify appendSyntheticMessage stores both user command and assistant output
const cmdMsg: UnifiedMessage = {
  id: randomUUID(),
  role: 'user',
  content: '/model gemini-2.5-flash',
  timestamp: Date.now(),
};

const replyMsg: UnifiedMessage = {
  id: randomUUID(),
  role: 'assistant',
  content: 'Switched active model to: gemini-2.5-flash (Provider: google)',
  timestamp: Date.now() + 1,
};

let messageEventFired = 0;
queryEngine.on('message', () => {
  messageEventFired++;
});

queryEngine.appendSyntheticMessage(cmdMsg);
queryEngine.appendSyntheticMessage(replyMsg);

assert.strictEqual(messageEventFired, 2, 'Must emit "message" event for each synthetic message');

const messagesAfterCommand = queryEngine.getMessages();
assert.ok(
  messagesAfterCommand.some((m) => m.content === '/model gemini-2.5-flash' && m.role === 'user'),
  'User slash command must be present in queryEngine.messages'
);
assert.ok(
  messagesAfterCommand.some(
    (m) => m.content.includes('Switched active model to') && m.role === 'assistant'
  ),
  'Assistant command response must be present in queryEngine.messages'
);

console.log('[PASS]: 2.1 - Synthetic slash command messages are persisted into session trajectory');

// 2. Verify user_message event fires synchronously when executeUserPrompt starts
let userMessageEventFired = false;
let userMessageReceived: UnifiedMessage | null = null;

queryEngine.on('user_message', (msg: UnifiedMessage) => {
  userMessageEventFired = true;
  userMessageReceived = msg;
});

// Clear API key to test fast credential preflight
const savedKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

try {
  await queryEngine.executeUserPrompt('write a check disk script');

  assert.strictEqual(userMessageEventFired, true, 'user_message event must fire upon execution start');
  assert.ok(userMessageReceived !== null, 'user_message event payload must be non-null');
  assert.strictEqual(
    (userMessageReceived as any)?.content,
    'write a check disk script',
    'user_message content must match user prompt'
  );

  // 3. Verify slash command messages were NOT erased or overwritten
  const messagesAfterPrompt = queryEngine.getMessages();
  assert.ok(
    messagesAfterPrompt.some((m) => m.content === '/model gemini-2.5-flash'),
    'Prior slash command must persist across subsequent turns'
  );
  assert.ok(
    messagesAfterPrompt.some((m) => m.content.includes('Switched active model to')),
    'Prior slash command response must persist across subsequent turns'
  );

  console.log('[PASS]: 2.2 - user_message event fires immediately and trajectory preserves all command turns');
} finally {
  if (savedKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = savedKey;
  }
}

console.log('[SUCCESS]: ALL SLASH COMMAND PERSISTENCE TESTS PASSED 100%!');
