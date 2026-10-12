import assert from 'assert';
import { z } from 'zod';
import { NetworkGuard } from '../providers/security/NetworkGuard.js';
import { SecretSanitizer } from '../providers/security/SecretSanitizer.js';
import { ToolExecutionGate } from '../providers/security/ToolExecutionGate.js';
import { ModelCatalogStore } from '../providers/catalog/ModelCatalogStore.js';
import { CapabilityNegotiator } from '../providers/core/CapabilityNegotiator.js';
import { ContinuousStateMachine } from '../engine/ContinuousStateMachine.js';
import { ProviderError } from '../providers/core/ProviderErrors.js';
import type { ToolDefinition, ToolCall } from '../types/index.js';

console.log('[TEST]: Starting InterShader Gateway v2.1.1 Production Security & Invariant Suite...');

// 1. SSRF_IPV4_MAPPED_IPV6
async function testIpv4MappedIpv6() {
  console.log('\n--- [1/10] SSRF: IPv4-Mapped IPv6 Decoding & Blocking ---');
  console.log('Claim: All IPv4-mapped IPv6 variants pointing to loopback or metadata endpoints are detected and rejected.');

  // IPv4-mapped loopback [::ffff:127.0.0.1]
  assert.throws(
    () => NetworkGuard.validateUrl('http://[::ffff:127.0.0.1]:8080/v1', false),
    /REJECT_SSRF_LOOPBACK/
  );

  // IPv4-mapped cloud metadata [::ffff:169.254.169.254]
  assert.throws(
    () => NetworkGuard.validateUrl('http://[::ffff:169.254.169.254]/latest/meta-data/', false),
    /REJECT_SSRF_METADATA_IP/
  );

  // IPv4-mapped private RFC 1918 [::ffff:10.0.0.1]
  assert.throws(
    () => NetworkGuard.validateUrl('http://[::ffff:10.0.0.1]:8000/v1', false),
    /REJECT_SSRF_INTERNAL_IP/
  );

  console.log('Evidence: [::ffff:127.0.0.1], [::ffff:169.254.169.254], and [::ffff:10.0.0.1] all threw expected SSRF rejections.');
  console.log('Limitations: Assumes standard URL bracket syntax for IPv6 hostnames.');
}

// 2. SSRF_ALTERNATIVE_ENCODING
async function testAlternativeIpEncoding() {
  console.log('\n--- [2/10] SSRF: Alternative Encodings (Decimal, Hex, Octal) ---');
  console.log('Claim: Non-standard IP literal representations cannot bypass loopback and metadata guards.');

  // Decimal 2130706433 = 127.0.0.1
  assert.throws(
    () => NetworkGuard.validateUrl('http://2130706433:8000/v1', false),
    /REJECT_SSRF_LOOPBACK/
  );

  // Decimal 2852039166 = 169.254.169.254
  assert.throws(
    () => NetworkGuard.validateUrl('http://2852039166/metadata', false),
    /REJECT_SSRF_METADATA_IP/
  );

  // Hex 0x7f000001 = 127.0.0.1
  assert.throws(
    () => NetworkGuard.validateUrl('http://0x7f000001/v1', false),
    /REJECT_SSRF_LOOPBACK/
  );

  // Octal dotted 0177.0.0.1 = 127.0.0.1
  assert.throws(
    () => NetworkGuard.validateUrl('http://0177.0.0.1:8000/v1', false),
    /REJECT_SSRF_LOOPBACK/
  );

  console.log('Evidence: Decimal, Hex, and Octal IP representations normalized and rejected.');
  console.log('Limitations: Evaluated at URL parse and hostname normalization boundary.');
}

// 3. SSRF_DNS_REBINDING
async function testDnsRebinding() {
  console.log('\n--- [3/10] SSRF: DNS Pre-Flight Rebinding Defense ---');
  console.log('Claim: Domains resolving to RFC 1918, loopback, or metadata addresses are aborted before connection.');

  const mockRebindingResolver = async (host: string): Promise<string[]> => {
    if (host === 'rebind-to-internal.attacker.com') {
      return ['10.20.30.40'];
    }
    if (host === 'rebind-to-metadata.attacker.com') {
      return ['169.254.169.254'];
    }
    if (host === 'safe.api.anthropic.com') {
      return ['104.18.2.100'];
    }
    return ['127.0.0.1'];
  };

  // Rebinding to RFC 1918
  await assert.rejects(
    async () => NetworkGuard.resolveAndValidateHost('rebind-to-internal.attacker.com', false, mockRebindingResolver),
    /REJECT_SSRF_DNS_REBINDING/
  );

  // Rebinding to Metadata
  await assert.rejects(
    async () => NetworkGuard.resolveAndValidateHost('rebind-to-metadata.attacker.com', false, mockRebindingResolver),
    /REJECT_SSRF_DNS_REBINDING/
  );

  // Valid public host passes
  const validIps = await NetworkGuard.resolveAndValidateHost('safe.api.anthropic.com', false, mockRebindingResolver);
  assert.deepStrictEqual(validIps, ['104.18.2.100']);

  console.log('Evidence: Malicious domains resolving to internal/metadata addresses rejected with REJECT_SSRF_DNS_REBINDING.');
  console.log('Limitations: Relies on pre-flight DNS lookup; subsequent socket-level connection assumes OS DNS cache consistency.');
}

// 4. SSRF_MULTI_HOP_REDIRECT
async function testMultiHopRedirectValidation() {
  console.log('\n--- [4/10] SSRF: Multi-Hop Redirect Chain Re-Verification ---');
  console.log('Claim: Every HTTP redirect step is strictly re-evaluated; redirects to metadata are aborted.');

  // Mock global fetch for redirect simulation
  const originalFetch = globalThis.fetch;
  let hopIndex = 0;

  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      hopIndex++;
      const urlStr = input.toString();
      if (hopIndex === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://intermediate-hop.com/step2' },
        });
      }
      if (hopIndex === 2) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('OK', { status: 200 });
    }) as unknown as typeof fetch;

    const mockDns = async () => ['104.18.2.100'];

    await assert.rejects(
      async () =>
        NetworkGuard.safeFetch(
          'http://safe-start.com/api',
          {},
          { dnsResolver: mockDns, socketConnector: async (url) => fetch(url, { redirect: 'manual' }) }
        ),
      /REJECT_SSRF_METADATA_IP/
    );

    console.log('Evidence: Multi-hop redirect stopped at Hop 2 when Location targeted 169.254.169.254.');
  } finally {
    globalThis.fetch = originalFetch;
  }
  console.log('Limitations: In-memory fetch mock simulates HTTP 302 hop traversal.');
}

// 5. CAPABILITY_PROVENANCE_AUDIT
async function testCapabilityProvenance() {
  console.log('\n--- [5/10] Provenance: Catalog Verification Source & Configuration Version ---');
  console.log('Claim: Built-in verified models contain verifiable provenance authority, timestamp, and version hash.');

  const claudeDesc = ModelCatalogStore.get('anthropic', 'claude-3-7-sonnet-20250219');
  assert.ok(claudeDesc, 'Expected claude-3-7-sonnet-20250219 to be registered');
  assert.ok(claudeDesc.provenance, 'Expected provenance metadata on verified model');
  assert.strictEqual(claudeDesc.provenance.verifierAuthority, 'intershader-gateway-verifier-v2.1');
  assert.strictEqual(claudeDesc.provenance.configurationVersion, '2.1.1');
  assert.ok(claudeDesc.provenance.verifiedAt > 0);
  assert.ok(claudeDesc.provenance.verifiedHash?.startsWith('sha256:'));

  const isValid = CapabilityNegotiator.validateProvenance(claudeDesc, 'intershader-gateway-verifier-v2.1');
  assert.strictEqual(isValid, true);

  console.log('Evidence: Verified model provenance confirmed with authority, timestamp, and SHA256 digest.');
  console.log('Limitations: Catalog hash is deterministic based on provider, modelId, and gateway version.');
}

// 6. SAFE_FALLBACK_INVARIANT
async function testSafeFallbackInvariant() {
  console.log('\n--- [6/10] Reliability: Safe Fallback Invariant with Active Tools ---');
  console.log('Claim: State machine refuses fallback to models lacking tool calling capability when tools are required.');

  // Create machine with fallback to deepseek-reasoner (which has toolCalling: 'unsupported')
  const machine = new ContinuousStateMachine({
    initialProvider: 'openai',
    initialModel: 'gpt-4o',
    fallbackProviders: [
      { provider: 'deepseek', model: 'deepseek-reasoner' }, // Unsupported tools
    ],
  });

  const dummyTool: ToolDefinition = {
    name: 'test_executor',
    description: 'A test tool',
    inputSchema: z.object({ query: z.string() }),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async () => ({ result: 'ok' }),
  };

  // Mock initialProvider streamChat to simulate 529 Overloaded error
  (machine as unknown as { currentProvider: { streamChat: () => AsyncIterable<unknown> } }).currentProvider = {
    streamChat: () => ({
      async *[Symbol.asyncIterator]() {
        throw new Error('529 Provider Overloaded');
      },
    }),
  };

  // Must reject fallback and throw FALLBACK_CAPABILITY_MISMATCH
  await assert.rejects(
    async () =>
      machine.executeStep(
        [{ id: 'msg-test-1', timestamp: Date.now(), role: 'user', content: 'Run tool' }],
        [dummyTool]
      ),
    /FALLBACK_CAPABILITY_MISMATCH/
  );

  console.log('Evidence: ContinuousStateMachine blocked silent degradation to non-tool model (deepseek-reasoner).');
  console.log('Limitations: Tested with synthetic 529 overload condition.');
}

// 7. TOOL_SCHEMA_GATE_INVALID_ARGS
async function testToolSchemaGateValidation() {
  console.log('\n--- [7/10] Tool Execution Gate: Zod Schema Validation ---');
  console.log('Claim: Arguments failing Zod schema are rejected before emitting tool_call.ready or execution.');

  const sampleTool: ToolDefinition = {
    name: 'calculate_tax',
    description: 'Calculate tax amount',
    inputSchema: z.object({
      income: z.number().positive(),
      state: z.string().length(2),
    }),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async () => ({ tax: 100 }),
  };

  // Case A: Missing required property 'state' and wrong type for 'income'
  const malformedCall: ToolCall = {
    id: 'call_invalid_schema_1',
    name: 'calculate_tax',
    arguments: { income: 'not-a-number' },
    rawArguments: '{"income": "not-a-number"}',
  };

  assert.throws(
    () => ToolExecutionGate.validateToolCall(malformedCall, [sampleTool]),
    /INVALID_TOOL_ARGUMENTS/
  );

  // Case B: Valid arguments pass cleanly
  const validCall: ToolCall = {
    id: 'call_valid_schema_2',
    name: 'calculate_tax',
    arguments: { income: 50000, state: 'CA' },
    rawArguments: '{"income": 50000, "state": "CA"}',
  };

  assert.doesNotThrow(() => ToolExecutionGate.validateToolCall(validCall, [sampleTool]));

  console.log('Evidence: Invalid schema arguments rejected with INVALID_TOOL_ARGUMENTS; valid args passed.');
  console.log('Limitations: Relies on Zod schema definitions supplied by tool registration.');
}

// 8. TOOL_DUPLICATE_ID_REJECTION
async function testDuplicateCallIdRejection() {
  console.log('\n--- [8/10] Tool Execution Gate: Duplicate Call ID Rejection ---');
  console.log('Claim: Emitting identical tool_call IDs in the same stream session throws REJECT_DUPLICATE_TOOL_CALL_ID.');

  const sampleTool: ToolDefinition = {
    name: 'noop',
    description: 'noop',
    inputSchema: z.object({}),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async () => ({}),
  };

  const seenIds = new Set<string>();

  const call1: ToolCall = {
    id: 'dup_call_id_123',
    name: 'noop',
    arguments: {},
  };

  const call2: ToolCall = {
    id: 'dup_call_id_123',
    name: 'noop',
    arguments: {},
  };

  ToolExecutionGate.validateToolCall(call1, [sampleTool], seenIds);
  assert.strictEqual(seenIds.size, 1);

  assert.throws(
    () => ToolExecutionGate.validateToolCall(call2, [sampleTool], seenIds),
    /REJECT_DUPLICATE_TOOL_CALL_ID/
  );

  console.log('Evidence: Duplicate call ID "dup_call_id_123" detected and rejected.');
  console.log('Limitations: ID deduplication is scoped per streaming request turn.');
}

// 9. TOOL_PAYLOAD_SIZE_LIMIT
async function testToolPayloadSizeLimit() {
  console.log('\n--- [9/10] Tool Execution Gate: Payload Budget & Memory Defense ---');
  console.log('Claim: Tool argument payloads exceeding configured byte budget are rejected immediately.');

  const sampleTool: ToolDefinition = {
    name: 'bulk_data_tool',
    description: 'bulk tool',
    inputSchema: z.object({ payload: z.string() }),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async () => ({}),
  };

  // Create a 2 MB payload string with a 1 MB limit option
  const largeString = 'A'.repeat(2 * 1024 * 1024);
  const oversizedCall: ToolCall = {
    id: 'oversized_call_1',
    name: 'bulk_data_tool',
    arguments: { payload: largeString },
    rawArguments: JSON.stringify({ payload: largeString }),
  };

  assert.throws(
    () => ToolExecutionGate.validateToolCall(oversizedCall, [sampleTool], undefined, { maxPayloadBytes: 1024 * 1024 }),
    /REJECT_TOOL_PAYLOAD_TOO_LARGE/
  );

  console.log('Evidence: 2 MB payload exceeded 1 MB budget and was rejected with REJECT_TOOL_PAYLOAD_TOO_LARGE.');
  console.log('Limitations: Measured via Buffer.byteLength in UTF-8.');
}

// 10. SECRET_SANITIZATION_ERROR_PIPELINE
async function testSecretSanitizationPipeline() {
  console.log('\n--- [10/10] Security: Universal Secret Redaction Across Error Pipeline ---');
  console.log('Claim: API keys (OpenAI, Anthropic, Gemini), Bearer tokens, and Authorization headers are scrubbed from errors and stack traces.');

  const testApiKey = 'sk-proj-superSecretLiveKey1234567890abcdefghij';
  const testAnthropicKey = 'sk-ant-api03-liveSecretKeyAnthropic9876543210';
  const testGeminiKey = 'AIzaSyA1234567890abcdefghijklmnopqrst';
  const testBearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.signature';

  // Test SecretSanitizer directly
  const rawLog = `Failed upstream: key=${testApiKey}, ant=${testAnthropicKey}, gemini=${testGeminiKey}, auth=${testBearer}, authorization: Bearer secret-token-header-123`;
  const sanitized = SecretSanitizer.sanitize(rawLog);

  assert.ok(!sanitized.includes(testApiKey), 'OpenAI key leaked!');
  assert.ok(!sanitized.includes(testAnthropicKey), 'Anthropic key leaked!');
  assert.ok(!sanitized.includes(testGeminiKey), 'Gemini key leaked!');
  assert.ok(!sanitized.includes('secret-token-header-123'), 'Auth header leaked!');
  assert.ok(sanitized.includes('[REDACTED_API_KEY]'));
  assert.ok(sanitized.includes('[REDACTED_TOKEN]'));

  // Test ProviderError message and stack trace scrubbing
  const rawError = new Error(`Connection to provider failed: api_key=${testApiKey}\n    at Socket.connect (/app/net.js:12:34)`);
  const providerErr = ProviderError.fromUnknown(rawError);

  assert.ok(!providerErr.message.includes(testApiKey), 'ProviderError.message leaked secret!');
  if (providerErr.stack) {
    assert.ok(!providerErr.stack.includes(testApiKey), 'ProviderError.stack leaked secret!');
  }

  console.log('Evidence: SecretSanitizer and ProviderError scrubbed all test credentials from messages and stack traces.');
  console.log('Limitations: Matches predefined high-entropy API key regex signatures.');
}

async function main() {
  await testIpv4MappedIpv6();
  await testAlternativeIpEncoding();
  await testDnsRebinding();
  await testMultiHopRedirectValidation();
  await testCapabilityProvenance();
  await testSafeFallbackInvariant();
  await testToolSchemaGateValidation();
  await testDuplicateCallIdRejection();
  await testToolPayloadSizeLimit();
  await testSecretSanitizationPipeline();

  console.log('\n=============================================================');
  console.log('Gateway v2.1.1 Production Security Suite: 10/10 PASSED');
  console.log('SSRF Defense, DNS Rebinding, Tool Gates & Sanitization: VERIFIED');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('[ERROR]: Production security test suite failed:', err);
  process.exit(1);
});
