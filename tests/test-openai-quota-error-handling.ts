import assert from 'assert';
import { randomUUID } from 'crypto';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { setupCommand } from '../cli/commands/builtinCommands.js';
import type { SessionConfig } from '../types/index.js';

console.log('[TEST]: Starting OpenAI Quota & Provider Error Diagnostics Test Suite...');

// 1. Test OpenAI 429 Insufficient Quota ($0 Balance)
{
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_BASE_URL;

  const sessionConfig: SessionConfig = {
    sessionId: randomUUID(),
    provider: 'openai',
    model: 'gpt-4o',
    cwd: process.cwd(),
    maxTokens: 160000,
    permissionMode: 'default',
  };

  const queryEngine = new QueryEngine(sessionConfig);

  const rawOpenAiError = JSON.stringify({
    error: {
      message: 'You exceeded your current quota, please check your plan and billing details.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    },
  });

  const formatted = queryEngine.formatProviderError(rawOpenAiError);

  if (originalBaseUrl) {
    process.env.OPENAI_BASE_URL = originalBaseUrl;
  }

  assert.ok(
    formatted.includes('[OpenAI Quota Exceeded (429)]'),
    'Must include [OpenAI Quota Exceeded (429)] header'
  );
  assert.ok(
    formatted.includes('Credit Balance = $0.00'),
    'Must explicitly state $0.00 credit balance'
  );
  assert.ok(
    formatted.includes('https://platform.openai.com/account/billing'),
    'Must include OpenAI billing URL'
  );
  assert.ok(
    formatted.includes('/key test openai'),
    'Must suggest /key test openai'
  );
  assert.ok(
    formatted.includes('/model'),
    'Must suggest switching models via /model'
  );

  console.log('[PASS]: 1.1 - OpenAI 429 Insufficient Quota formatted with billing guidance and model switch');
}

// 2. Test Google Gemini Rate Limit (429) with retry window
{
  const sessionConfig: SessionConfig = {
    sessionId: randomUUID(),
    provider: 'google',
    model: 'gemini-2.5-flash',
    cwd: process.cwd(),
    maxTokens: 160000,
    permissionMode: 'default',
  };

  const queryEngine = new QueryEngine(sessionConfig);

  const rawGeminiError = 'Resource has been exhausted (e.g. check quota). Please retry in 42s.';
  const formatted = queryEngine.formatProviderError(rawGeminiError);

  assert.ok(
    formatted.includes('Quota Exceeded (429)]'),
    'Must include Quota Exceeded (429)] header'
  );
  assert.ok(
    formatted.includes('Thoi gian cho retry: 42s'),
    'Must extract retry window (42s)'
  );
  assert.ok(
    formatted.includes('/model'),
    'Must suggest switching models via /model'
  );

  console.log('[PASS]: 1.2 - Gemini 429 Rate Limit extracted retry window and guidance');
}

// 3. Test /key test command diagnostics
{
  const unknownRes = await setupCommand.execute({
    args: ['test', 'nonexistent_provider'],
    cwd: process.cwd(),
    sessionState: {} as any,
  });
  assert.ok(
    typeof unknownRes === 'string' && unknownRes.includes('Unknown provider'),
    'Must reject unknown provider'
  );

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  try {
    const notSetRes = await setupCommand.execute({
      args: ['test', 'openai'],
      cwd: process.cwd(),
      sessionState: {} as any,
    });

    assert.ok(
      typeof notSetRes === 'string' && notSetRes.includes('[NOT SET]'),
      'Must notify that key is not configured'
    );
    assert.ok(
      typeof notSetRes === 'string' && notSetRes.includes('/key openai <your_api_key>'),
      'Must suggest syntax to set key'
    );
  } finally {
    if (originalKey !== undefined) {
      process.env.OPENAI_API_KEY = originalKey;
    }
  }

  console.log('[PASS]: 1.3 - /key test handles unknown providers and missing keys cleanly');
}

console.log('[SUCCESS]: ALL OPENAI QUOTA & ERROR REPORTING TESTS PASSED 100%!');
