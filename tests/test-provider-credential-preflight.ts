import assert from 'assert';
import { randomUUID } from 'crypto';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { SessionConfig } from '../types/index.js';

console.log('[TEST]: Starting Provider Credential Pre-flight & Error Reporting Test Suite...');

// Save current env and clear ANTHROPIC_API_KEY to test missing key behavior
const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

try {
  const sessionConfig: SessionConfig = {
    sessionId: randomUUID(),
    provider: 'anthropic',
    model: 'claude-3-7-sonnet-20250219',
    cwd: process.cwd(),
    maxTokens: 160000,
    permissionMode: 'default',
  };

  const queryEngine = new QueryEngine(sessionConfig);

  // 1. Verify executeUserPrompt returns clear guidance when API key is missing
  console.log('[RUNNING]: Submitting test prompt with unconfigured API key...');
  const response = await queryEngine.executeUserPrompt('hello');

  assert.ok(response && response.length > 0, 'Response must not be empty');
  assert.ok(
    response.includes('[Authentication Required]'),
    'Response must contain [Authentication Required] tag'
  );
  assert.ok(
    response.includes('ANTHROPIC_API_KEY'),
    'Response must reference ANTHROPIC_API_KEY'
  );
  assert.ok(
    response.includes('/setup'),
    'Response must advise user about /setup command'
  );
  console.log('[PASS]: 1.1 - QueryEngine returns actionable authentication guidance instead of empty response');

  // 2. Verify messages list does NOT contain any empty assistant message
  const messages = queryEngine.getMessages();
  assert.ok(messages.length >= 2, 'Must have at least system, user, and assistant message');

  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  assert.strictEqual(assistantMsgs.length, 1, 'Must have exactly 1 assistant response');

  const lastAssistant = assistantMsgs[0]!;
  assert.ok(
    lastAssistant.content.trim().length > 0,
    'Assistant message content must not be blank'
  );
  assert.strictEqual(
    lastAssistant.content,
    response,
    'Recorded assistant message matches returned response'
  );
  console.log('[PASS]: 1.2 - Assistant message in session store is non-empty and contains guidance text');

  console.log('[SUCCESS]: ALL PROVIDER CREDENTIAL PRE-FLIGHT TESTS PASSED 100%!');
} finally {
  // Restore original environment key
  if (savedAnthropicKey !== undefined) {
    process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  }
}
