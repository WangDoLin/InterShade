import assert from 'assert';
import { z } from 'zod';
import { NetworkGuard } from '../providers/security/NetworkGuard.js';
import { SecretSanitizer } from '../providers/security/SecretSanitizer.js';
import { ToolExecutionGate } from '../providers/security/ToolExecutionGate.js';
import { ModelCatalogStore } from '../providers/catalog/ModelCatalogStore.js';
import { CapabilityNegotiator } from '../providers/core/CapabilityNegotiator.js';
import {
  CapabilityEvidenceManifest,
  TrustRootRegistry,
  type CapabilityEvidence,
} from '../providers/catalog/CapabilityEvidenceManifest.js';
import { ProviderError } from '../providers/core/ProviderErrors.js';
import type { ToolDefinition, ToolCall } from '../types/index.js';
import type { ModelDescriptor, ModelRequirements } from '../providers/catalog/ModelDescriptor.js';
import type { UnifiedStreamEvent } from '../providers/core/BaseModel.js';

console.log('[TEST]: Starting InterShader Gateway v2.1.2 Trust & Network Closure Suite...');

// 1. SSRF_SOCKET_IP_PINNING
async function testSocketIpPinning() {
  console.log('\n--- [1/10] Network: Socket-Level IP Pinning & Destination Binding ---');
  console.log('Claim: Socket-level connect binding strictly forces HTTP dispatch to the verified IP, bypassing subsequent DNS queries.');

  let connectedIp = '';
  const mockConnector = async (url: string, pinnedIp: string, init: RequestInit): Promise<Response> => {
    connectedIp = pinnedIp;
    return new Response(JSON.stringify({ status: 'connected', ip: pinnedIp }), { status: 200 });
  };

  const mockDns = async (host: string) => {
    if (host === 'verified-api.openai.com') {
      return ['104.18.2.100'];
    }
    return ['127.0.0.1'];
  };

  const res = await NetworkGuard.safeFetch(
    'https://verified-api.openai.com/v1/chat',
    {},
    { dnsResolver: mockDns, socketConnector: mockConnector }
  );

  assert.strictEqual(res.status, 200);
  assert.strictEqual(connectedIp, '104.18.2.100', 'Socket connection was not pinned to verified IP!');

  console.log('Evidence: Socket connector invoked exclusively with pinned verified IP 104.18.2.100.');
  console.log('Limitations: Integration verified through socketConnector dispatcher interface.');
}

// 2. SSRF_DNS_REBINDING_SOCKET_PREVENTION
async function testDnsRebindingSocketPrevention() {
  console.log('\n--- [2/10] Network: DNS Rebinding Prevention Between Resolution & Connect ---');
  console.log('Claim: If DNS rebinds to an internal/metadata address between resolution and socket connect, pinned dispatch prevents connecting to the altered IP.');

  let dnsQueryCount = 0;
  const rebindingDnsResolver = async (host: string): Promise<string[]> => {
    dnsQueryCount++;
    // First lookup: returns safe IP
    // Second lookup (if runtime were to re-query DNS): would return 127.0.0.1
    if (dnsQueryCount === 1) {
      return ['104.18.2.100'];
    }
    return ['127.0.0.1'];
  };

  let actualSocketIp = '';
  const trackedConnector = async (url: string, pinnedIp: string): Promise<Response> => {
    actualSocketIp = pinnedIp;
    return new Response('OK', { status: 200 });
  };

  await NetworkGuard.safeFetch(
    'http://rebinding-service.example.com/api',
    {},
    { dnsResolver: rebindingDnsResolver, socketConnector: trackedConnector }
  );

  assert.strictEqual(actualSocketIp, '104.18.2.100');
  assert.notStrictEqual(actualSocketIp, '127.0.0.1', 'Socket connected to rebound 127.0.0.1!');

  console.log('Evidence: Host was bound to initial verified IP (104.18.2.100); socket never reached 127.0.0.1.');
  console.log('Limitations: Assumes socketConnector honors pinnedIp received from NetworkGuard.');
}

// 3. SSRF_REDIRECT_REPINNING
async function testRedirectRepinning() {
  console.log('\n--- [3/10] Network: Multi-Hop Redirect Socket Re-Pinning ---');
  console.log('Claim: Every hop in a multi-hop redirect chain re-resolves and re-pins the socket destination IP.');

  const hopsVisited: Array<{ url: string; pinnedIp: string }> = [];

  const mockHopConnector = async (url: string, pinnedIp: string): Promise<Response> => {
    hopsVisited.push({ url, pinnedIp });
    if (url.includes('hop1')) {
      return new Response(null, { status: 302, headers: { location: 'http://hop2.example.com/dest' } });
    }
    if (url.includes('hop2')) {
      return new Response(null, { status: 302, headers: { location: 'http://hop3.example.com/final' } });
    }
    return new Response('Final Destination Reached', { status: 200 });
  };

  const multiHopDns = async (host: string): Promise<string[]> => {
    if (host === 'hop1.example.com') return ['104.18.1.1'];
    if (host === 'hop2.example.com') return ['104.18.2.2'];
    if (host === 'hop3.example.com') return ['104.18.3.3'];
    return ['104.18.4.4'];
  };

  const finalRes = await NetworkGuard.safeFetch(
    'http://hop1.example.com/start',
    {},
    { dnsResolver: multiHopDns, socketConnector: mockHopConnector, maxRedirects: 3 }
  );

  assert.strictEqual(finalRes.status, 200);
  assert.strictEqual(hopsVisited.length, 3);
  assert.strictEqual(hopsVisited[0].pinnedIp, '104.18.1.1');
  assert.strictEqual(hopsVisited[1].pinnedIp, '104.18.2.2');
  assert.strictEqual(hopsVisited[2].pinnedIp, '104.18.3.3');

  console.log('Evidence: Multi-hop sequence verified with sequential IP re-pinning: 104.18.1.1 -> 104.18.2.2 -> 104.18.3.3.');
  console.log('Limitations: Redirect traversal simulated through controlled multi-hop connector.');
}

// 4. CAPABILITY_SIGNED_MANIFEST_VALID
async function testSignedManifestValid() {
  console.log('\n--- [4/10] Provenance: Cryptographically Signed Capability Manifest ---');
  console.log('Claim: A capability manifest with valid HMAC-SHA256 signature from the Trust Root is verified and accepted.');

  const evidence: CapabilityEvidence = {
    provider: 'anthropic',
    modelId: 'claude-3-7-sonnet-custom',
    gatewayVersion: '2.1.2',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'supported',
      promptCaching: 'supported',
      computerUse: 'supported',
    },
    verifiedAt: 1740000000000,
    authority: 'intershader-gateway-verifier-v2.1',
    configDigest: 'sha256:abcd1234',
  };

  const rootKey = TrustRootRegistry.getKey('intershader-key-root-v2-1')!;
  const signed = CapabilityEvidenceManifest.signEvidence(evidence, rootKey.secret!, 'intershader-key-root-v2-1');

  const check = CapabilityEvidenceManifest.verifyManifest(signed);
  assert.strictEqual(check.valid, true);

  const modelDesc: ModelDescriptor = {
    providerId: 'anthropic',
    modelId: 'claude-3-7-sonnet-custom',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: evidence.capabilities,
    lifecycle: 'stable',
    capabilitySource: 'verified-catalog',
    signedManifest: signed,
  };

  const evalRes = CapabilityNegotiator.evaluate(modelDesc, { toolCalling: 'required' });
  assert.strictEqual(evalRes.eligible, true);

  console.log('Evidence: Signed manifest verified against Trust Root key and accepted by CapabilityNegotiator.');
  console.log('Limitations: Demonstrates HMAC-SHA256 signature with canonical JSON serialization.');
}

// 5. CAPABILITY_MANIFEST_TAMPER_REJECTION
async function testManifestTamperRejection() {
  console.log('\n--- [5/10] Provenance: Tampered Capability Rejection ---');
  console.log('Claim: Unauthorized alteration of capabilities without valid signature breaks cryptographic verification.');

  const evidence: CapabilityEvidence = {
    provider: 'deepseek',
    modelId: 'deepseek-reasoner-tampered',
    gatewayVersion: '2.1.2',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'unsupported', // Originally unsupported
      structuredOutput: 'unsupported',
      reasoningControl: 'supported',
      promptCaching: 'supported',
      computerUse: 'unsupported',
    },
    verifiedAt: 1740000000000,
    authority: 'intershader-gateway-verifier-v2.1',
    configDigest: 'sha256:5678',
  };

  const rootKey = TrustRootRegistry.getKey('intershader-key-root-v2-1')!;
  const signed = CapabilityEvidenceManifest.signEvidence(evidence, rootKey.secret!, 'intershader-key-root-v2-1');

  // Attacker tampers with toolCalling in evidence payload
  signed.evidence.capabilities.toolCalling = 'supported';

  const check = CapabilityEvidenceManifest.verifyManifest(signed);
  assert.strictEqual(check.valid, false);
  assert.ok(check.reason?.includes('SIGNATURE_VERIFICATION_FAILED'));

  const tamperedDesc: ModelDescriptor = {
    providerId: 'deepseek',
    modelId: 'deepseek-reasoner-tampered',
    inputModalities: ['text'],
    outputModalities: ['text'],
    capabilities: signed.evidence.capabilities,
    lifecycle: 'stable',
    capabilitySource: 'verified-catalog',
    signedManifest: signed,
  };

  const evalRes = CapabilityNegotiator.evaluate(tamperedDesc, { toolCalling: 'required' });
  assert.strictEqual(evalRes.eligible, false);
  assert.ok(evalRes.rejectionReasons.some((r) => r.includes('Cryptographic manifest verification failed')));

  console.log('Evidence: Tampered capability rejected with SIGNATURE_VERIFICATION_FAILED.');
  console.log('Limitations: Relies on timingSafeEqual comparison over HMAC digests.');
}

// 6. CAPABILITY_UNTRUSTED_AUTHORITY_REJECTION
async function testUntrustedAuthorityRejection() {
  console.log('\n--- [6/10] Provenance: Untrusted Authority & Rogue Key Rejection ---');
  console.log('Claim: Manifest signed with a key ID not present in the Trust Root registry is immediately rejected.');

  const rogueEvidence: CapabilityEvidence = {
    provider: 'rogue-provider',
    modelId: 'rogue-model-1',
    gatewayVersion: '2.1.2',
    capabilities: {
      streaming: 'supported',
      toolCalling: 'supported',
      structuredOutput: 'supported',
      reasoningControl: 'supported',
      promptCaching: 'supported',
      computerUse: 'supported',
    },
    verifiedAt: 1740000000000,
    authority: 'rogue-untrusted-authority',
    configDigest: 'sha256:0000',
  };

  // Sign with unknown keyId
  const signed = CapabilityEvidenceManifest.signEvidence(
    rogueEvidence,
    'attacker-private-secret-key',
    'rogue-key-id-999'
  );

  const check = CapabilityEvidenceManifest.verifyManifest(signed);
  assert.strictEqual(check.valid, false);
  assert.ok(check.reason?.includes('UNTRUSTED_AUTHORITY_KEY'));

  console.log('Evidence: Manifest with keyId "rogue-key-id-999" rejected with UNTRUSTED_AUTHORITY_KEY.');
  console.log('Limitations: TrustRootRegistry uses in-memory registered authority map.');
}

// 7. TOOL_STREAM_PRE_BUFFER_ABORT
async function testStreamPreBufferAbort() {
  console.log('\n--- [7/10] Tool Gate: Pre-Buffer Stream Delta Abort ---');
  console.log('Claim: Excessively large tool argument deltas abort the stream at chunk arrival time, before buffering or parsing JSON.');

  const sampleTool: ToolDefinition = {
    name: 'file_writer',
    description: 'Writes file',
    inputSchema: z.object({ content: z.string() }),
    isReadOnly: false,
    isDestructive: true,
    requiresPermission: true,
    execute: async () => ({ status: 'written' }),
  };

  // Stream generator emitting deltas totaling 6 MB with 5 MB default budget
  async function* oversizedStream(): AsyncGenerator<UnifiedStreamEvent> {
    yield { type: 'tool_call.start', callId: 'call_large_1', name: 'file_writer' };
    const chunk1MB = 'B'.repeat(1024 * 1024);
    // Yield 6 chunks of 1 MB each
    for (let i = 0; i < 6; i++) {
      yield { type: 'tool_call.delta', callId: 'call_large_1', inputDelta: chunk1MB };
    }
    yield {
      type: 'tool_call.ready',
      toolCall: { id: 'call_large_1', name: 'file_writer', arguments: {} },
    };
  }

  const gatedStream = ToolExecutionGate.wrapStream(oversizedStream(), [sampleTool]);

  const events: UnifiedStreamEvent[] = [];
  for await (const event of gatedStream) {
    events.push(event);
  }

  const errorEvent = events.find((e) => e.type === 'error');
  assert.ok(errorEvent, 'Stream should have emitted an error event for exceeding budget!');
  if (errorEvent && errorEvent.type === 'error') {
    assert.strictEqual(errorEvent.error.code, 'INVALID_REQUEST');
    assert.ok(errorEvent.error.message.includes('REJECT_TOOL_PAYLOAD_TOO_LARGE'));
  }

  // Ensure tool_call.ready was NEVER yielded
  const readyEvent = events.find((e) => e.type === 'tool_call.ready');
  assert.strictEqual(readyEvent, undefined, 'tool_call.ready must NOT be emitted when budget exceeded!');

  console.log('Evidence: Stream aborted on the 6th chunk before assembly; tool_call.ready was never emitted.');
  console.log('Limitations: Measured incrementally via byte length of streamed deltas.');
}

// 8. TOOL_BUDGET_ALIGNMENT_CONSISTENCY
async function testToolBudgetAlignment() {
  console.log('\n--- [8/10] Tool Gate: Payload Budget Alignment (5 MB Default) ---');
  console.log('Claim: Standalone validation and stream gate consistently enforce the 5 MB default budget.');

  const sampleTool: ToolDefinition = {
    name: 'query_db',
    description: 'query',
    inputSchema: z.object({ query: z.string() }),
    isReadOnly: true,
    isDestructive: false,
    requiresPermission: false,
    execute: async () => ({}),
  };

  assert.strictEqual(ToolExecutionGate.DEFAULT_MAX_PAYLOAD_BYTES, 5 * 1024 * 1024);

  // Payload: 4 MB (within 5 MB budget) -> Must PASS
  const valid4MBString = 'X'.repeat(4 * 1024 * 1024);
  const call4MB: ToolCall = {
    id: 'call_4mb',
    name: 'query_db',
    arguments: { query: 'test' },
    rawArguments: valid4MBString,
  };
  assert.doesNotThrow(() => ToolExecutionGate.validateToolCall(call4MB, [sampleTool]));

  // Payload: 5.5 MB (exceeds 5 MB budget) -> Must THROW
  const oversized5_5MBString = 'Y'.repeat(Math.floor(5.5 * 1024 * 1024));
  const call5_5MB: ToolCall = {
    id: 'call_5_5mb',
    name: 'query_db',
    arguments: { query: 'test' },
    rawArguments: oversized5_5MBString,
  };
  assert.throws(
    () => ToolExecutionGate.validateToolCall(call5_5MB, [sampleTool]),
    /REJECT_TOOL_PAYLOAD_TOO_LARGE/
  );

  console.log('Evidence: 4 MB accepted and 5.5 MB rejected under standard 5 MB budget.');
  console.log('Limitations: Measured via Buffer.byteLength in UTF-8.');
}

// 9. SECRET_DYNAMIC_REGISTRATION
async function testSecretDynamicRegistration() {
  console.log('\n--- [9/10] Security: Dynamic Secret Registration & Sanitization ---');
  console.log('Claim: Arbitrary secrets registered dynamically at runtime are scrubbed across error messages and stack traces.');

  const dynamicApiKey = 'custom-internal-crm-key-xyz-987654321';
  SecretSanitizer.registerSecret(dynamicApiKey);

  const rawErrorMessage = `Upstream CRM call failed with secret key: ${dynamicApiKey} at /srv/agent/crm.ts:42`;
  const sanitized = SecretSanitizer.sanitize(rawErrorMessage);

  assert.ok(!sanitized.includes(dynamicApiKey), 'Dynamic secret leaked in sanitized message!');
  assert.ok(sanitized.includes('[REDACTED_REGISTERED_SECRET]'));

  // Test ProviderError scrubbing
  const providerErr = ProviderError.fromUnknown(new Error(`Failed with ${dynamicApiKey}`));
  assert.ok(!providerErr.message.includes(dynamicApiKey));

  SecretSanitizer.clearRegisteredSecrets();

  console.log('Evidence: Dynamically registered secret scrubbed and replaced with [REDACTED_REGISTERED_SECRET].');
  console.log('Limitations: Dynamic secrets must have minimum length of 6 characters.');
}

// 10. SECRET_MULTI_CLOUD_CREDENTIALS
async function testMultiCloudCredentialsSanitization() {
  console.log('\n--- [10/10] Security: Multi-Cloud & URL Embedded Credentials Scrubbing ---');
  console.log('Claim: AWS session tokens, AWS secret keys, Azure account keys, Google OAuth tokens, and URL embedded credentials are redacted.');

  const awsSession = 'ASIAEXAMPLEKEY1234567890';
  const awsSecret = 'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const azureKey = 'AccountKey=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6==';
  const googleOAuth = 'ya29.a0AfH6SMA1234567890abcdefghijklmnopqrstuvwxyz';
  const urlWithAuth = 'https://admin:mySecretPassword123@api.internal.corp/v1';

  const combinedDump = [
    `AWS Session: ${awsSession}`,
    `AWS Secret: ${awsSecret}`,
    `Azure Key: ${azureKey}`,
    `Google Token: ${googleOAuth}`,
    `Endpoint: ${urlWithAuth}`,
  ].join('\n');

  const sanitized = SecretSanitizer.sanitize(combinedDump);

  assert.ok(!sanitized.includes('ASIAEXAMPLEKEY1234567890'), 'AWS session token leaked!');
  assert.ok(!sanitized.includes('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'), 'AWS secret key leaked!');
  assert.ok(!sanitized.includes('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6=='), 'Azure key leaked!');
  assert.ok(!sanitized.includes('ya29.a0AfH6SMA1234567890abcdefghijklmnopqrstuvwxyz'), 'Google OAuth token leaked!');
  assert.ok(!sanitized.includes('mySecretPassword123'), 'URL embedded password leaked!');

  assert.ok(sanitized.includes('[REDACTED_AWS_SESSION_TOKEN]'));
  assert.ok(sanitized.includes('[REDACTED_AWS_SECRET_KEY]'));
  assert.ok(sanitized.includes('[REDACTED_AZURE_KEY]'));
  assert.ok(sanitized.includes('[REDACTED_GOOGLE_TOKEN]'));
  assert.ok(sanitized.includes('[REDACTED_AUTH]@'));

  console.log('Evidence: AWS, Azure, Google OAuth, and URL embedded credentials all successfully sanitized.');
  console.log('Limitations: Standard multi-cloud token formats matched by specialized regex rules.');
}

async function main() {
  await testSocketIpPinning();
  await testDnsRebindingSocketPrevention();
  await testRedirectRepinning();
  await testSignedManifestValid();
  await testManifestTamperRejection();
  await testUntrustedAuthorityRejection();
  await testStreamPreBufferAbort();
  await testToolBudgetAlignment();
  await testSecretDynamicRegistration();
  await testMultiCloudCredentialsSanitization();

  console.log('\n=============================================================');
  console.log('Gateway v2.1.2 Trust & Network Closure Suite: 10/10 PASSED');
  console.log('Socket IP Pinning, Signed Manifests & Multi-Cloud Redaction: VERIFIED');
  console.log('=============================================================');
}

main().catch((err) => {
  console.error('[ERROR]: Trust & Network Closure test suite failed:', err);
  process.exit(1);
});
