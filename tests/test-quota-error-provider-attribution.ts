import assert from 'node:assert';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import { planCommand } from '../cli/commands/builtinCommands.js';

console.log('=== Running Quota & Error Provider Attribution Tests ===');

// 1. Test: Google Gemini error containing "billing details" must NOT be attributed to OpenAI
{
  const googleEngine = new QueryEngine({
    provider: 'google',
    model: 'gemini-3.8-flash',
    cwd: process.cwd(),
    resumeSession: false,
    permissionMode: 'default',
    maxTokens: 4096,
  });

  const rawGeminiError = 'GoogleGenerativeAIError: [429 Too Many Requests] Quota exceeded for quota metric. Please check your plan and billing details or retry in 42s.';
  const formatted = googleEngine.formatProviderError(rawGeminiError);

  console.log('Formatted Gemini 429:\n' + formatted);
  assert.ok(formatted.includes('[Google Gemini Rate Limit / Quota Exceeded (429)]'), 'Must contain Google Gemini header');
  assert.ok(!formatted.includes('OpenAI Quota Exceeded'), 'Must NOT contain OpenAI Quota Exceeded');
  assert.ok(!formatted.includes('Tai khoan OpenAI chua co so du'), 'Must NOT mention OpenAI $0 credit balance');
  assert.ok(formatted.includes('42s'), 'Must extract retry duration');
  assert.ok(formatted.includes('ag/gemini-3.8-flash-high'), 'Must suggest 9Router gateway alternative');
  console.log('[PASS]: 1. Google Gemini 429 error correctly attributed to Google Gemini, never to OpenAI');
}

// 2. Test: OpenAI error containing insufficient quota attributes to OpenAI
{
  const originalBaseUrl = process.env.OPENAI_BASE_URL;
  delete process.env.OPENAI_BASE_URL;

  const openAiEngine = new QueryEngine({
    provider: 'openai',
    model: 'gpt-4o',
    cwd: process.cwd(),
    resumeSession: false,
    permissionMode: 'default',
    maxTokens: 4096,
  });

  const rawOpenAiError = '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}';
  const formatted = openAiEngine.formatProviderError(rawOpenAiError);

  assert.ok(formatted.includes('[OpenAI Quota Exceeded (429)]'), 'Must contain OpenAI header');
  assert.ok(formatted.includes('platform.openai.com/account/billing'), 'Must contain OpenAI billing link');
  console.log('[PASS]: 2. OpenAI 429 error correctly formatted for OpenAI official');

  if (originalBaseUrl) {
    process.env.OPENAI_BASE_URL = originalBaseUrl;
  }
}

// 3. Test: 9Router Proxy 429 error guidance
{
  process.env.OPENAI_BASE_URL = 'http://localhost:20128/v1';
  const proxyEngine = new QueryEngine({
    provider: 'openai',
    model: 'ag/gemini-3.8-flash-high',
    cwd: process.cwd(),
    resumeSession: false,
    permissionMode: 'default',
    maxTokens: 4096,
  });

  const rawProxyError = '429 Too Many Requests: No active credentials for provider';
  const formatted = proxyEngine.formatProviderError(rawProxyError);

  assert.ok(formatted.includes('9Router Gateway'), 'Must mention 9Router Gateway');
  assert.ok(formatted.includes('http://localhost:20128'), 'Must mention 9Router web UI URL');
  console.log('[PASS]: 3. 9Router proxy 429 correctly directs user to localhost:20128');
}

// 4. Test: planCommand execution with and without target path
{
  const state: Record<string, unknown> = { permissionMode: 'default' };

  // 4a: Toggle on
  const res1 = await planCommand.execute({ cwd: process.cwd(), sessionState: state as any, args: [] });
  assert.strictEqual(state.permissionMode, 'plan');
  assert.ok(res1.includes('[PLAN MODE ON]'));

  // 4b: Set target scope
  const res2 = await planCommand.execute({ cwd: process.cwd(), sessionState: state as any, args: ['E:\\InterShade\\InterShade-code-agent'] });
  assert.strictEqual(state.permissionMode, 'plan');
  assert.ok(res2.includes('Target Scope: E:\\InterShade\\InterShade-code-agent'));

  // 4c: Toggle off
  const res3 = await planCommand.execute({ cwd: process.cwd(), sessionState: state as any, args: [] });
  assert.strictEqual(state.permissionMode, 'default');
  assert.ok(res3.includes('[PLAN MODE OFF]'));
  console.log('[PASS]: 4. planCommand properly toggles mode and handles target scope path');
}

console.log('=== All Quota Attribution Tests PASSED ===');
