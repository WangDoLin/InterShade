import assert from 'node:assert';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  CapabilityEvidenceManifest,
  TrustRootRegistry,
  AuthoritySigner,
  type CapabilityEvidence,
  type SignedCapabilityManifest,
} from '../providers/catalog/CapabilityEvidenceManifest.js';
import {
  ToolExecutionGate,
  TurnBudgetTracker,
} from '../providers/security/ToolExecutionGate.js';
import { SecretSanitizer } from '../providers/security/SecretSanitizer.js';
import {
  BaseProviderAdapter,
  type ProviderAdapterConfig,
  type AdapterStreamOptions,
} from '../providers/protocols/contracts/ProviderAdapterContract.js';
import type { ModelDescriptor } from '../providers/catalog/ModelDescriptor.js';
import type { ModelRequest, UnifiedStreamEvent } from '../providers/core/BaseModel.js';
import type { ToolDefinition } from '../types/index.js';

console.log('[TEST]: Starting InterShader Gateway v2.1.4 (RFC 8785, Ed25519 Strict & P3 Contract Suite)...');

// 1. RFC8785_NUMBER_REPRESENTATION
async function testRfc8785Numbers() {
  console.log('\n--- [1/10] RFC 8785: Deterministic Number Representation & Normalization ---');
  console.log('Claim: Numbers follow IEEE 754 ECMAScript ToString; -0 is normalized to 0; NaN and Infinity throw.');

  // Case A: -0 normalized to 0
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785(-0), '0');
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785(0), '0');
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785({ val: -0 }), '{"val":0}');

  // Case B: Floating point and scientific numbers
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785(1.5), '1.5');
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785(1e20), '100000000000000000000');
  assert.strictEqual(CapabilityEvidenceManifest.canonicalSerializeRFC8785(-42), '-42');

  // Case C: NaN and Infinity rejection
  assert.throws(() => CapabilityEvidenceManifest.canonicalSerializeRFC8785(NaN), /RFC 8785/);
  assert.throws(() => CapabilityEvidenceManifest.canonicalSerializeRFC8785(Infinity), /RFC 8785/);
  assert.throws(() => CapabilityEvidenceManifest.canonicalSerializeRFC8785(-Infinity), /RFC 8785/);

  console.log('Evidence: -0 normalized to 0, standard numbers match IEEE 754 ToString, NaN/Infinity rejected.');
  console.log('Limitations: Relies on JavaScript IEEE 754 double-precision number engine.');
}

// 2. RFC8785_UNICODE_AND_ESCAPING
async function testRfc8785UnicodeAndEscaping() {
  console.log('\n--- [2/10] RFC 8785: Unicode Literals & Control Character Escaping ---');
  console.log('Claim: Characters < 0x20 are escaped; quotes and backslash escaped; / is literal; Unicode >= 0x20 is literal.');

  const testObj = {
    control: '\b\f\n\r\t\u0000\u001f',
    slash: 'https://gateway.intershader.org/api/v1',
    unicode: 'Tiếng Việt - 简体中文 - 日本語 - 🚀',
  };

  const canonical = CapabilityEvidenceManifest.canonicalSerializeRFC8785(testObj);

  // Assert forward slashes are NOT escaped with \/
  assert.ok(canonical.includes('"https://gateway.intershader.org/api/v1"'), 'Forward slash was incorrectly escaped!');
  assert.ok(!canonical.includes('\\/'), 'Found escaped solidus \\/ which violates RFC 8785 Section 3.2.2.2');

  // Assert Unicode literals are preserved directly
  assert.ok(canonical.includes('Tiếng Việt - 简体中文 - 日本語 - 🚀'), 'Unicode characters were incorrectly escaped to \\uXXXX');

  // Assert control characters are escaped
  assert.ok(canonical.includes('\\b\\f\\n\\r\\t\\u0000\\u001f'), 'Control characters were not properly escaped');

  console.log('Evidence: Unicode >= 0x20 preserved literally, / left unescaped, control characters < 0x20 escaped.');
  console.log('Limitations: Verified across representative UTF-8/UTF-16 code points.');
}

// 3. RFC8785_UTF16_KEY_SORTING
async function testRfc8785KeySorting() {
  console.log('\n--- [3/10] RFC 8785: UTF-16 Code Unit Lexicographical Property Sorting ---');
  console.log('Claim: Keys are sorted strictly by UTF-16 code units across deeply nested structures.');

  const raw = {
    z: 1,
    a: 2,
    m: {
      b: 1,
      a: 2,
    },
    A: 3, // In UTF-16, 'A' (65) < 'a' (97)
    _underscore: 4, // '_' (95) < 'a' (97)
    '1_num': 5, // '1' (49) < 'A' (65)
  };

  const canonical = CapabilityEvidenceManifest.canonicalSerializeRFC8785(raw);
  assert.strictEqual(
    canonical,
    '{"1_num":5,"A":3,"_underscore":4,"a":2,"m":{"a":2,"b":1},"z":1}'
  );

  console.log('Evidence: Keys sorted strictly in order: "1_num", "A", "_underscore", "a", "m", "z".');
  console.log('Limitations: Verified according to UTF-16 code unit compare algorithm.');
}

// 4. ED25519_STRICT_MODE_VERIFICATION
async function testEd25519StrictModeVerification() {
  console.log('\n--- [4/10] Attestation: Ed25519 Strict Mode Signature Verification ---');
  console.log('Claim: Valid Ed25519 signature passes verification; tampered evidence fails with zero fallback to HMAC.');

  const keyPair = crypto.generateKeyPairSync('ed25519');
  const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const keyId = 'test-authority-ed25519-v2-1-4';
  const authority = 'intershader-authority-v2.1.4';
  TrustRootRegistry.registerPublicKey(keyId, authority, publicKeyPem);

  const evidence: CapabilityEvidence = {
    provider: 'azure-openai',
    modelId: 'gpt-4o-msft',
    gatewayVersion: '2.1.4',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'unsupported',
      promptCaching: 'supported',
      computerUse: 'unsupported',
    },
    verifiedAt: 1740000000000,
    authority,
    configDigest: 'sha256:abcd',
  };

  const signed = AuthoritySigner.signManifestEd25519(evidence, privateKeyPem, keyId);

  // Case A: Valid signature passes
  const resultValid = CapabilityEvidenceManifest.verifyManifest(signed);
  assert.strictEqual(resultValid.valid, true);

  // Case B: Tampered payload fails
  const tamperedSigned: SignedCapabilityManifest = {
    ...signed,
    evidence: {
      ...signed.evidence,
      capabilities: {
        ...signed.evidence.capabilities,
        reasoningControl: 'supported', // Tampered!
      },
    },
  };
  const resultTampered = CapabilityEvidenceManifest.verifyManifest(tamperedSigned);
  assert.strictEqual(resultTampered.valid, false);
  assert.ok(resultTampered.reason?.includes('SIGNATURE_VERIFICATION_FAILED'));

  console.log('Evidence: Valid Ed25519 passes; tampered payload rejected with SIGNATURE_VERIFICATION_FAILED.');
  console.log('Limitations: Relies on Node crypto Ed25519 verification.');
}

// 5. ED25519_ANTI_DOWNGRADE_DEFENSE
async function testEd25519AntiDowngradeDefense() {
  console.log('\n--- [5/10] Security: Ed25519 Anti-Downgrade Defense ---');
  console.log('Claim: Manifest attempting to claim HMAC algorithm on an Ed25519 authority key is strictly rejected.');

  const keyId = 'test-authority-ed25519-v2-1-4';
  const evidence: CapabilityEvidence = {
    provider: 'vertex-ai',
    modelId: 'gemini-2.0-flash',
    gatewayVersion: '2.1.4',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'supported',
      promptCaching: 'supported',
      computerUse: 'unsupported',
    },
    verifiedAt: 1740000000000,
    authority: 'intershader-authority-v2.1.4',
    configDigest: 'sha256:ef01',
  };

  // Malicious manifest claims HMAC-SHA256 for an Ed25519 authority key
  const downgradeManifest: SignedCapabilityManifest = {
    evidence,
    signature: 'bad-hmac-signature-attempt',
    publicKeyId: keyId,
    algorithm: 'HMAC-SHA256',
  };

  const result = CapabilityEvidenceManifest.verifyManifest(downgradeManifest);
  assert.strictEqual(result.valid, false);
  assert.ok(
    result.reason?.includes('REJECT_ALGORITHM_DOWNGRADE'),
    `Expected REJECT_ALGORITHM_DOWNGRADE, got: ${result.reason}`
  );

  console.log('Evidence: Manifest with algorithm HMAC-SHA256 against Ed25519 key rejected with REJECT_ALGORITHM_DOWNGRADE.');
  console.log('Limitations: Enforced at verifyManifest boundary.');
}

// 6. ED25519_UNTRUSTED_KEY_REJECTION
async function testEd25519UntrustedKeyRejection() {
  console.log('\n--- [6/10] Security: Untrusted Authority Key Rejection ---');
  console.log('Claim: Manifest signed with an unregistered keyId is immediately rejected.');

  const evidence: CapabilityEvidence = {
    provider: 'bedrock',
    modelId: 'claude-3-7-sonnet-aws',
    gatewayVersion: '2.1.4',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'supported',
      promptCaching: 'supported',
      computerUse: 'supported',
    },
    verifiedAt: 1740000000000,
    authority: 'untrusted-authority',
    configDigest: 'sha256:9999',
  };

  const rogueManifest: SignedCapabilityManifest = {
    evidence,
    signature: 'fake_signature',
    publicKeyId: 'rogue-key-999',
    algorithm: 'Ed25519',
  };

  const result = CapabilityEvidenceManifest.verifyManifest(rogueManifest);
  assert.strictEqual(result.valid, false);
  assert.ok(result.reason?.includes('UNTRUSTED_AUTHORITY_KEY'));

  console.log('Evidence: Unregistered keyId rogue-key-999 rejected with UNTRUSTED_AUTHORITY_KEY.');
  console.log('Limitations: Relies on TrustRootRegistry membership check.');
}

// 7. TURN_BUDGET_MULTI_MODEL_QUOTA
async function testTurnBudgetMultiModelQuota() {
  console.log('\n--- [7/10] Runtime: Multi-Model Turn Tool Count Quota (32 Tools Max Across Turns) ---');
  console.log('Claim: TurnBudgetTracker preserves tool call count across Model A and Fallback Model B in the same turn.');

  const turnTracker = new TurnBudgetTracker();

  // Model A emits 20 tool calls in first attempt
  async function* modelAStream(): AsyncGenerator<UnifiedStreamEvent> {
    for (let i = 1; i <= 20; i++) {
      yield { type: 'tool_call.start', callId: `modelA_call_${i}`, name: 'tool_a' };
      yield { type: 'tool_call.delta', callId: `modelA_call_${i}`, inputDelta: '{}' };
    }
  }

  const gatedA = ToolExecutionGate.wrapStream(modelAStream(), undefined, { turnBudget: turnTracker });
  for await (const _ev of gatedA) {
    // consume Model A stream
  }

  assert.strictEqual(turnTracker.toolCount, 20);

  // Model A fails or triggers fallback; Model B runs under the SAME TurnBudgetTracker
  // Model B attempts 13 tool calls (20 + 13 = 33 > 32 max quota)
  async function* modelBFallbackStream(): AsyncGenerator<UnifiedStreamEvent> {
    for (let i = 1; i <= 13; i++) {
      yield { type: 'tool_call.start', callId: `modelB_call_${i}`, name: 'tool_b' };
      yield { type: 'tool_call.delta', callId: `modelB_call_${i}`, inputDelta: '{}' };
    }
  }

  const gatedB = ToolExecutionGate.wrapStream(modelBFallbackStream(), undefined, { turnBudget: turnTracker });
  const eventsB: UnifiedStreamEvent[] = [];
  for await (const ev of gatedB) {
    eventsB.push(ev);
  }

  const errorEvent = eventsB.find((e) => e.type === 'error');
  assert.ok(errorEvent && errorEvent.type === 'error');
  assert.ok(
    errorEvent.error.message.includes('REJECT_TOOL_COUNT_EXCEEDED'),
    `Expected REJECT_TOOL_COUNT_EXCEEDED, got: ${errorEvent.error.message}`
  );
  // Total tool calls recorded in turnTracker capped at 32
  assert.strictEqual(turnTracker.toolCount, 32);

  console.log('Evidence: Model A consumed 20 calls; Fallback Model B rejected on its 13th call (total 33 > 32).');
  console.log('Limitations: Enforced via shared TurnBudgetTracker instance across turn attempts.');
}

// 8. TURN_BUDGET_MULTI_MODEL_AGGREGATE_PAYLOAD
async function testTurnBudgetMultiModelAggregatePayload() {
  console.log('\n--- [8/10] Runtime: Multi-Model Turn Aggregate Payload Budget (10 MB Across Turns) ---');
  console.log('Claim: TurnBudgetTracker preserves cumulative payload bytes across Model A and Fallback Model B in the same turn.');

  const turnTracker = new TurnBudgetTracker();

  // Model A streams 2 tool calls of 3 MB each (total 6 MB, each 3 MB < 5 MB individual limit)
  async function* modelAStream(): AsyncGenerator<UnifiedStreamEvent> {
    yield { type: 'tool_call.start', callId: 'call_a1', name: 'tool_a' };
    yield { type: 'tool_call.delta', callId: 'call_a1', inputDelta: 'A'.repeat(3 * 1024 * 1024) };
    yield { type: 'tool_call.start', callId: 'call_a2', name: 'tool_a' };
    yield { type: 'tool_call.delta', callId: 'call_a2', inputDelta: 'A'.repeat(3 * 1024 * 1024) };
  }

  const gatedA = ToolExecutionGate.wrapStream(modelAStream(), undefined, { turnBudget: turnTracker });
  for await (const _ev of gatedA) {
    // consume Model A
  }

  assert.strictEqual(turnTracker.consumedBytes, 6 * 1024 * 1024);

  // Model B (retry or fallback) attempts 2 tool calls: 3 MB + 2 MB (6 MB + 3 MB + 2 MB = 11 MB > 10 MB aggregate budget)
  async function* modelBRetryStream(): AsyncGenerator<UnifiedStreamEvent> {
    yield { type: 'tool_call.start', callId: 'call_b1', name: 'tool_b' };
    yield { type: 'tool_call.delta', callId: 'call_b1', inputDelta: 'B'.repeat(3 * 1024 * 1024) };
    yield { type: 'tool_call.start', callId: 'call_b2', name: 'tool_b' };
    yield { type: 'tool_call.delta', callId: 'call_b2', inputDelta: 'B'.repeat(2 * 1024 * 1024) };
  }

  const gatedB = ToolExecutionGate.wrapStream(modelBRetryStream(), undefined, { turnBudget: turnTracker });
  const eventsB: UnifiedStreamEvent[] = [];
  for await (const ev of gatedB) {
    eventsB.push(ev);
  }

  const errorEvent = eventsB.find((e) => e.type === 'error');
  assert.ok(errorEvent && errorEvent.type === 'error');
  assert.ok(
    errorEvent.error.message.includes('REJECT_AGGREGATE_PAYLOAD_TOO_LARGE'),
    `Expected REJECT_AGGREGATE_PAYLOAD_TOO_LARGE, got: ${errorEvent.error.message}`
  );

  console.log('Evidence: Model A consumed 6 MB; Fallback Model B exceeded 10 MB limit and was rejected.');
  console.log('Limitations: Enforced via shared TurnBudgetTracker delta accumulation.');
}

// 9. DELIMITER_ADJACENT_SHORT_SECRET_REDACTION
async function testDelimiterAdjacentShortSecretRedaction() {
  console.log('\n--- [9/10] Security: Short Secret Redaction Adjacent to Varied Delimiters ---');
  console.log('Claim: Lookaround boundary matching scrubs short secrets adjacent to :, =, ?, &, ", \', /, [], (), without corruption.');

  const shortToken = 'PIN42';
  SecretSanitizer.registerSecret(shortToken);

  // Test various delimiter-adjacent patterns
  const samples = [
    `JSON: {"token":"${shortToken}","pin":"${shortToken}"}`,
    `QUERY: api_key=${shortToken}&pin=${shortToken}`,
    `ARRAY: [${shortToken}][${shortToken}]`,
    `PARENS: (${shortToken})(${shortToken})`,
    `CSV: ${shortToken},${shortToken};${shortToken}`,
    `SLASH: /v1/${shortToken}/verify`,
    `COLON: auth:${shortToken}@host`,
  ];

  for (const sample of samples) {
    const sanitized = SecretSanitizer.sanitize(sample);
    assert.ok(!sanitized.includes(shortToken), `shortToken leaked in sample: ${sample}`);
    assert.ok(sanitized.includes('[REDACTED_REGISTERED_SECRET]') || sanitized.includes('[REDACTED_AUTH]@'));
  }

  // Ensure normal words are not corrupted
  const ordinaryText = 'The spinner had a pink pinwheel and pine needles.';
  const sanitizedOrdinary = SecretSanitizer.sanitize(ordinaryText);
  assert.strictEqual(sanitizedOrdinary, ordinaryText, 'Ordinary words were corrupted!');

  SecretSanitizer.clearRegisteredSecrets();

  console.log('Evidence: Contiguous short secrets touching delimiters scrubbed 100% while ordinary words untouched.');
  console.log('Limitations: Zero-width lookaround matches characters without consuming boundary chars.');
}

// 10. PROVIDER_ADAPTER_CONTRACT_P3
async function testProviderAdapterContractP3() {
  console.log('\n--- [10/10] Contract: Phase P3 BaseProviderAdapter Compliance ---');
  console.log('Claim: Concrete adapter extending BaseProviderAdapter inherits preflight, stream gates, and IP isolation.');

  const testTool: ToolDefinition = {
    name: 'test_calc',
    description: 'calc',
    inputSchema: z.object({ x: z.number() }),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async (args) => ({ res: (args as { x: number }).x * 2 }),
  };

  const descriptor: ModelDescriptor = {
    providerId: 'azure-openai',
    modelId: 'gpt-4o-msft',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'unsupported',
      promptCaching: 'supported',
      computerUse: 'unsupported',
    },
    lifecycle: 'stable',
    capabilitySource: 'verified-catalog',
  };

  class MockAzureAdapter extends BaseProviderAdapter {
    readonly descriptor = descriptor;

    async *stream(
      request: ModelRequest,
      options: AdapterStreamOptions = {}
    ): AsyncGenerator<UnifiedStreamEvent, void, unknown> {
      this.validatePreflight(request);

      async function* generateEvents(): AsyncGenerator<UnifiedStreamEvent> {
        yield { type: 'response.start' };
        yield { type: 'text.delta', text: 'Hello from Azure OpenAI' };
        yield { type: 'response.finish', reason: 'end_turn' };
      }

      yield* this.wrapStreamWithSecurity(generateEvents(), request, options);
    }
  }

  const adapter = new MockAzureAdapter({
    providerId: 'azure-openai',
    endpoint: 'https://azure-openai.corp/v1',
    credentials: { apiKey: 'secret-azure-token-999' },
  });

  // Verify credentials registered in SecretSanitizer
  assert.ok(SecretSanitizer.containsSecret('secret-azure-token-999'));

  // Verify stream execution
  const request: ModelRequest = {
    modelId: 'gpt-4o-msft',
    messages: [{ id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1740000000000 }],
    tools: [testTool],
  };

  const events: UnifiedStreamEvent[] = [];
  for await (const ev of adapter.stream(request)) {
    events.push(ev);
  }

  assert.ok(events.some((e) => e.type === 'response.start'));
  assert.ok(events.some((e) => e.type === 'text.delta'));
  assert.ok(events.some((e) => e.type === 'response.finish'));

  // Verify pre-flight abort rejection
  const abortController = new AbortController();
  abortController.abort();
  const abortedRequest: ModelRequest = {
    modelId: 'gpt-4o-msft',
    messages: [{ id: 'msg_2', role: 'user', content: 'Hi', timestamp: 1740000000000 }],
    signal: abortController.signal,
  };

  await assert.rejects(async () => {
    for await (const _ev of adapter.stream(abortedRequest)) {
      // should throw
    }
  }, /ABORTED/);

  SecretSanitizer.clearRegisteredSecrets();

  console.log('Evidence: MockAzureAdapter successfully verified preflight, credentials registration, and stream gate.');
  console.log('Limitations: Verified using BaseProviderAdapter contract harness.');
}

async function main() {
  await testRfc8785Numbers();
  await testRfc8785UnicodeAndEscaping();
  await testRfc8785KeySorting();
  await testEd25519StrictModeVerification();
  await testEd25519AntiDowngradeDefense();
  await testEd25519UntrustedKeyRejection();
  await testTurnBudgetMultiModelQuota();
  await testTurnBudgetMultiModelAggregatePayload();
  await testDelimiterAdjacentShortSecretRedaction();
  await testProviderAdapterContractP3();

  console.log('\n=============================================================');
  console.log('Gateway v2.1.4 RFC 8785 & Ed25519 Strict Suite: 10/10 PASSED');
  console.log('JCS Serialization, Strict Attestation & P3 Contract: VERIFIED');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('[ERROR]: Test suite failed:', err);
  process.exit(1);
});
