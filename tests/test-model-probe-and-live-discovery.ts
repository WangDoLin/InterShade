import assert from 'node:assert';
import { ModelDiscovery } from '../providers/catalog/ModelDiscovery.js';
import { ModelCatalogStore } from '../providers/catalog/ModelCatalogStore.js';
import { ConnectionRegistry } from '../providers/core/ConnectionRegistry.js';
import { ModelProbeEngine } from '../providers/reliability/ModelProbeEngine.js';
import { GatewayFormatter } from '../providers/catalog/GatewayFormatter.js';
import { SecretSanitizer } from '../providers/security/SecretSanitizer.js';
import { NetworkGuard } from '../providers/security/NetworkGuard.js';
import type { ConnectionProfile } from '../providers/profiles/ProviderProfile.js';

console.log('[TEST]: Starting Model Discovery & Live Provider Probe Engine Suite...');

// Mock helpers
const originalFetch = globalThis.fetch;

function cleanup() {
  globalThis.fetch = originalFetch;
  NetworkGuard.setMockConnector(undefined);
  SecretSanitizer.clearRegisteredSecrets();
}

// 1. DISCOVERY_ANTHROPIC
async function testDiscoveryAnthropic() {
  console.log('\n--- [1/10] Discovery: Live Model Discovery from Anthropic API ---');
  console.log('Claim: ModelDiscovery queries https://api.anthropic.com/v1/models with x-api-key and registers models.');

  const anthropicConn: ConnectionProfile = {
    id: 'anthropic-discovery-test',
    providerId: 'anthropic',
    protocolId: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com/v1',
    staticApiKey: 'sk-ant-test-discovery-key',
  };

  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};

  NetworkGuard.setMockConnector(async (url: string, _pinnedIp: string, init?: RequestInit) => {
    capturedUrl = url.toString();
    capturedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(
      JSON.stringify({
        data: [
          { id: 'claude-3-opus-20240229', type: 'model' },
          { id: 'claude-3-7-sonnet-latest', type: 'model' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const discovered = await ModelDiscovery.discover(anthropicConn);
  assert.ok(capturedUrl.includes('/models'), `Expected /models endpoint, got: ${capturedUrl}`);
  assert.strictEqual(capturedHeaders['x-api-key'], 'sk-ant-test-discovery-key');
  assert.strictEqual(capturedHeaders['anthropic-version'], '2023-06-01');
  assert.ok(discovered.some((m) => m.modelId === 'claude-3-opus-20240229'));
  assert.ok(discovered.some((m) => m.modelId === 'claude-3-7-sonnet-latest'));

  console.log('Evidence: Discovered 2 Anthropic models using proper x-api-key and anthropic-version headers.');
  cleanup();
}

// 2. DISCOVERY_GOOGLE
async function testDiscoveryGoogle() {
  console.log('\n--- [2/10] Discovery: Live Model Discovery from Google GenAI API ---');
  console.log('Claim: ModelDiscovery queries Google models endpoint, trims "models/" prefix, and registers descriptors.');

  const googleConn: ConnectionProfile = {
    id: 'google-discovery-test',
    providerId: 'google',
    protocolId: 'google-genai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    staticApiKey: 'ai-google-test-key',
  };

  NetworkGuard.setMockConnector(async (url: string) => {
    assert.ok(url.toString().includes('key=ai-google-test-key'));
    return new Response(
      JSON.stringify({
        models: [
          { name: 'models/gemini-2.0-flash-exp' },
          { name: 'models/gemini-1.5-pro-latest' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const discovered = await ModelDiscovery.discover(googleConn);
  assert.ok(discovered.some((m) => m.modelId === 'gemini-2.0-flash-exp'));
  assert.ok(discovered.some((m) => m.modelId === 'gemini-1.5-pro-latest'));

  console.log('Evidence: Discovered Google models with "models/" prefix cleanly stripped.');
  cleanup();
}

// 3. DISCOVERY_OPENAI_COMPATIBLE
async function testDiscoveryOpenAICompatible() {
  console.log('\n--- [3/10] Discovery: Live Model Discovery from OpenAI-Compatible API ---');
  console.log('Claim: ModelDiscovery queries /v1/models with Bearer auth and registers discovered models.');

  const openaiConn: ConnectionProfile = {
    id: 'openai-discovery-test',
    providerId: 'openai',
    protocolId: 'openai-chat-completions',
    baseURL: 'https://api.openai.com/v1',
    staticApiKey: 'sk-openai-discovery-key',
  };

  NetworkGuard.setMockConnector(async (_url: string, _pinnedIp: string, init?: RequestInit) => {
    const headers = (init?.headers || {}) as Record<string, string>;
    assert.strictEqual(headers.Authorization, 'Bearer sk-openai-discovery-key');
    return new Response(
      JSON.stringify({
        data: [
          { id: 'o3-mini' },
          { id: 'gpt-4.5-preview' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const discovered = await ModelDiscovery.discover(openaiConn);
  assert.ok(discovered.some((m) => m.modelId === 'o3-mini'));
  assert.ok(discovered.some((m) => m.modelId === 'gpt-4.5-preview'));

  console.log('Evidence: Discovered o3-mini and gpt-4.5-preview from OpenAI endpoint.');
  cleanup();
}

// 4. PROBE_USABLE_200
async function testProbeUsable200() {
  console.log('\n--- [4/10] Probe: Model USABLE (HTTP 200 OK Response) ---');
  console.log('Claim: When provider returns 200 OK, probe status is USABLE and round-trip latency is recorded.');

  const conn: ConnectionProfile = {
    id: 'anthropic-probe-test',
    providerId: 'anthropic',
    protocolId: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com/v1',
    staticApiKey: 'sk-ant-valid-key',
  };

  let capturedBody = '';
  NetworkGuard.setMockConnector(async (_url: string, _pinnedIp: string, init?: RequestInit) => {
    capturedBody = (init?.body || '').toString();
    return new Response(
      JSON.stringify({
        id: 'msg_probe_123',
        type: 'message',
        content: [{ type: 'text', text: 'pong' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const result = await ModelProbeEngine.probeModel(conn, 'claude-3-7-sonnet-20250219');
  assert.strictEqual(result.status, 'USABLE');
  assert.strictEqual(result.httpStatus, 200);
  assert.ok(result.latencyMs !== undefined && result.latencyMs >= 0);
  assert.ok(capturedBody.includes('"max_tokens":1'), 'Probe should request minimal 1 token');

  console.log(`Evidence: claude-3-7-sonnet-20250219 probed as USABLE with latency ${result.latencyMs}ms.`);
  cleanup();
}

// 5. PROBE_FORBIDDEN_403
async function testProbeForbidden403() {
  console.log('\n--- [5/10] Probe: Model Access FORBIDDEN (HTTP 403 Forbidden) ---');
  console.log('Claim: When API key lacks permissions for model (e.g. tier restrictions), probe returns FORBIDDEN.');

  const conn: ConnectionProfile = {
    id: 'anthropic-probe-opus',
    providerId: 'anthropic',
    protocolId: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com/v1',
    staticApiKey: 'sk-ant-tier1-key',
  };

  NetworkGuard.setMockConnector(async () => {
    return new Response(
      JSON.stringify({
        error: {
          type: 'permission_error',
          message: 'Your organization does not have access to claude-3-opus-20240229',
        },
      }),
      { status: 403, statusText: 'Forbidden', headers: { 'Content-Type': 'application/json' } }
    );
  });

  const result = await ModelProbeEngine.probeModel(conn, 'claude-3-opus-20240229');
  assert.strictEqual(result.status, 'FORBIDDEN');
  assert.strictEqual(result.httpStatus, 403);
  assert.ok(result.message.includes('forbidden') || result.message.includes('access'));

  console.log('Evidence: Probe detected 403 Forbidden for restricted model tier.');
  cleanup();
}

// 6. PROBE_NOT_FOUND_404
async function testProbeNotFound404() {
  console.log('\n--- [6/10] Probe: Model NOT_FOUND (HTTP 404 Not Found) ---');
  console.log('Claim: When model ID does not exist on provider, probe returns NOT_FOUND.');

  const conn: ConnectionProfile = {
    id: 'openai-probe-unknown',
    providerId: 'openai',
    protocolId: 'openai-chat-completions',
    baseURL: 'https://api.openai.com/v1',
    staticApiKey: 'sk-openai-key',
  };

  NetworkGuard.setMockConnector(async () => {
    return new Response(
      JSON.stringify({
        error: {
          message: 'The model `gpt-non-existent-version` does not exist',
          type: 'invalid_request_error',
        },
      }),
      { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'application/json' } }
    );
  });

  const result = await ModelProbeEngine.probeModel(conn, 'gpt-non-existent-version');
  assert.strictEqual(result.status, 'NOT_FOUND');
  assert.strictEqual(result.httpStatus, 404);

  console.log('Evidence: Probe detected 404 for non-existent model ID.');
  cleanup();
}

// 7. PROBE_AUTH_FAILED_401
async function testProbeAuthFailed401() {
  console.log('\n--- [7/10] Probe: Authentication Failed (HTTP 401 Unauthorized) ---');
  console.log('Claim: When API key is invalid or expired, probe returns AUTH_FAILED.');

  const conn: ConnectionProfile = {
    id: 'deepseek-probe-bad-key',
    providerId: 'deepseek',
    protocolId: 'openai-chat-completions',
    baseURL: 'https://api.deepseek.com',
    staticApiKey: 'sk-invalid-deepseek-key',
  };

  NetworkGuard.setMockConnector(async () => {
    return new Response(
      JSON.stringify({
        error: { message: 'Authentication Fails: Invalid API Key' },
      }),
      { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } }
    );
  });

  const result = await ModelProbeEngine.probeModel(conn, 'deepseek-chat');
  assert.strictEqual(result.status, 'AUTH_FAILED');
  assert.strictEqual(result.httpStatus, 401);

  console.log('Evidence: Probe detected 401 AUTH_FAILED for invalid API key.');
  cleanup();
}

// 8. PROBE_RATE_LIMITED_429
async function testProbeRateLimited429() {
  console.log('\n--- [8/10] Probe: Rate Limited or Quota Exhausted (HTTP 429) ---');
  console.log('Claim: When provider rate limit is exceeded, probe returns RATE_LIMITED.');

  const conn: ConnectionProfile = {
    id: 'openai-probe-429',
    providerId: 'openai',
    protocolId: 'openai-chat-completions',
    baseURL: 'https://api.openai.com/v1',
    staticApiKey: 'sk-openai-key',
  };

  NetworkGuard.setMockConnector(async () => {
    return new Response(
      JSON.stringify({
        error: { message: 'You exceeded your current quota' },
      }),
      { status: 429, statusText: 'Too Many Requests', headers: { 'Content-Type': 'application/json' } }
    );
  });

  const result = await ModelProbeEngine.probeModel(conn, 'gpt-4o');
  assert.strictEqual(result.status, 'RATE_LIMITED');
  assert.strictEqual(result.httpStatus, 429);

  console.log('Evidence: Probe detected 429 RATE_LIMITED.');
  cleanup();
}

// 9. PROBE_TIMEOUT_HANDLING
async function testProbeTimeoutHandling() {
  console.log('\n--- [9/10] Probe: Timeout Handling ---');
  console.log('Claim: Probe request that exceeds timeoutMs is cleanly aborted and returned as TIMEOUT.');

  const conn: ConnectionProfile = {
    id: 'timeout-probe-test',
    providerId: 'anthropic',
    protocolId: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com/v1',
    staticApiKey: 'sk-test-key',
  };

  NetworkGuard.setMockConnector(async (_url: string, _pinnedIp: string, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new Error('The operation was aborted.'));
      });
    });
  });

  const result = await ModelProbeEngine.probeModel(conn, 'claude-3-5-sonnet-20241022', 150);
  assert.strictEqual(result.status, 'TIMEOUT');
  assert.ok(result.message.includes('timed out'));

  console.log('Evidence: Slow probe aborted after 150ms and returned TIMEOUT.');
  cleanup();
}

// 10. FORMATTER_PROBE_REPORT_AND_SECRET_SAFETY
async function testFormatterProbeReport() {
  console.log('\n--- [10/10] Formatter: Structured Output & Zero Credential Exfiltration ---');
  console.log('Claim: GatewayFormatter formats clean terminal report with zero raw secrets.');

  const secretKey = 'sk-sensitive-token-9876543210';
  SecretSanitizer.registerSecret(secretKey);

  const mockResults = [
    {
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet-20250219',
      connectionId: 'anthropic-main',
      status: 'USABLE' as const,
      httpStatus: 200,
      latencyMs: 245,
      toolCallingSupport: 'supported' as const,
      message: 'Model is online, accessible, and responsive',
      testedAt: Date.now(),
    },
    {
      providerId: 'anthropic',
      modelId: 'claude-3-opus-20240229',
      connectionId: 'anthropic-main',
      status: 'FORBIDDEN' as const,
      httpStatus: 403,
      latencyMs: 180,
      toolCallingSupport: 'unknown' as const,
      message: `Access denied for key: ${secretKey}`,
      testedAt: Date.now(),
    },
    {
      providerId: 'openai',
      modelId: 'gpt-4.5-preview',
      connectionId: 'openai-main',
      status: 'NOT_FOUND' as const,
      httpStatus: 404,
      latencyMs: 195,
      toolCallingSupport: 'unknown' as const,
      message: 'Model ID not found by provider',
      testedAt: Date.now(),
    },
  ];

  const tableOutput = GatewayFormatter.formatModelProbeResults(mockResults);

  // Assert table headers
  assert.ok(tableOutput.includes('LIVE MODEL AVAILABILITY PROBE REPORT'));
  assert.ok(tableOutput.includes('claude-3-7-sonnet-20250219'));
  assert.ok(tableOutput.includes('USABLE'));
  assert.ok(tableOutput.includes('FORBIDDEN'));
  assert.ok(tableOutput.includes('NOT_FOUND'));

  // Assert zero secret leaked in table output
  assert.ok(!tableOutput.includes(secretKey), 'Secret token leaked in probe report output!');
  assert.ok(tableOutput.includes('[REDACTED_REGISTERED_SECRET]'), 'Expected redacted token marker in probe report');

  console.log('Evidence: Formatted 3 probe results into structured ASCII table; sensitive secret redacted.');
  console.log('\nSample Probe Report Output:');
  console.log(tableOutput);

  cleanup();
}

async function main() {
  await testDiscoveryAnthropic();
  await testDiscoveryGoogle();
  await testDiscoveryOpenAICompatible();
  await testProbeUsable200();
  await testProbeForbidden403();
  await testProbeNotFound404();
  await testProbeAuthFailed401();
  await testProbeRateLimited429();
  await testProbeTimeoutHandling();
  await testFormatterProbeReport();

  console.log('\n=============================================================');
  console.log('Live Model Discovery & Provider Probe Suite: 10/10 PASSED');
  console.log('Live Probing, Status Classification & Secret Safety: VERIFIED');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('[ERROR]: Test suite failed:', err);
  process.exit(1);
});
