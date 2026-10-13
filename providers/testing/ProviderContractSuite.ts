import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { LanguageModel, ModelRequest, UnifiedStreamEvent } from '../core/BaseModel.js';
import type { ModelDescriptor, ModelRequirements } from '../catalog/ModelDescriptor.js';
import { CapabilityNegotiator } from '../core/CapabilityNegotiator.js';
import { CompatibilityBridge } from '../core/CompatibilityBridge.js';
import { ProviderFactory } from '../ProviderFactory.js';
import { MockProtocolAdapter } from './MockProtocolAdapter.js';
import { ProviderRegistry } from '../core/ProviderRegistry.js';
import { ConnectionRegistry } from '../core/ConnectionRegistry.js';
import { ModelCatalogStore } from '../catalog/ModelCatalogStore.js';
import { ConnectionConfigLoader } from '../core/ConnectionConfigLoader.js';
import { ModelDiscovery } from '../catalog/ModelDiscovery.js';
import { ProviderHealthChecker } from '../reliability/ProviderHealthChecker.js';
import { GatewayFormatter } from '../catalog/GatewayFormatter.js';
import type { StreamEvent } from '../../types/index.js';

export interface ContractSuiteResult {
  passed: number;
  failed: number;
  details: string[];
}

export class ProviderContractSuite {
  static async runAll(): Promise<ContractSuiteResult> {
    let passed = 0;
    let failed = 0;
    const details: string[] = [];

    const mockAdapter = new MockProtocolAdapter();
    ProviderRegistry.register(mockAdapter);

    const testConnection = {
      id: 'mock-conn',
      providerId: 'mock-provider',
      protocolId: 'mock-protocol',
      defaultModelId: 'mock-v1',
    };
    ConnectionRegistry.register(testConnection);

    const testDescriptor: ModelDescriptor = {
      providerId: 'mock-provider',
      modelId: 'mock-v1',
      inputModalities: ['text'],
      outputModalities: ['text'],
      capabilities: {
        streaming: 'supported',
        toolCalling: 'supported',
        structuredOutput: 'supported',
        reasoningControl: 'supported',
        promptCaching: 'unsupported',
        computerUse: 'unsupported',
      },
      contextWindow: 128000,
      maxOutputTokens: 8192,
      lifecycle: 'stable',
      capabilitySource: 'verified-catalog',
    };
    ModelCatalogStore.register(testDescriptor);

    const model = mockAdapter.createModel(testConnection, testDescriptor);

    // 1. Test Stream Correctness
    try {
      mockAdapter.setBehavior({ mode: 'text', text: 'InterShader code generation test' });
      const events: UnifiedStreamEvent[] = [];
      const baseReq: ModelRequest = {
        modelId: 'mock-v1',
        messages: [{ id: '1', role: 'user', content: 'Generate code', timestamp: Date.now() }],
      };

      for await (const ev of model.stream(baseReq)) {
        events.push(ev);
      }

      assert.strictEqual(events[0].type, 'response.start');
      const textEvents = events.filter((e) => e.type === 'text.delta');
      assert.ok(textEvents.length > 0);
      const usageEvent = events.find((e) => e.type === 'usage');
      assert.ok(usageEvent);
      const finishEvent = events.find((e) => e.type === 'response.finish');
      assert.ok(finishEvent && finishEvent.type === 'response.finish' && finishEvent.reason === 'end_turn');

      passed++;
      details.push('PASS: Stream correctness (start, deltas, usage, finish)');
    } catch (err) {
      failed++;
      details.push(`FAIL: Stream correctness - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Test Tool Calling Fragment Assembly
    try {
      mockAdapter.setBehavior({
        mode: 'tool_call',
        toolId: 'call_123',
        toolName: 'write_file',
        argChunks: ['{"path":', '"src/main.ts"', ',"content":', '"console.log(1);"}'],
      });

      const events: UnifiedStreamEvent[] = [];
      const toolReq: ModelRequest = {
        modelId: 'mock-v1',
        messages: [{ id: '1', role: 'user', content: 'Write file', timestamp: Date.now() }],
      };

      for await (const ev of model.stream(toolReq)) {
        events.push(ev);
      }

      const startEv = events.find((e) => e.type === 'tool_call.start');
      assert.ok(startEv && startEv.type === 'tool_call.start' && startEv.callId === 'call_123');

      const deltaEvents = events.filter((e) => e.type === 'tool_call.delta');
      assert.strictEqual(deltaEvents.length, 4);

      const readyEv = events.find((e) => e.type === 'tool_call.ready');
      assert.ok(readyEv && readyEv.type === 'tool_call.ready');
      assert.strictEqual(readyEv.toolCall.name, 'write_file');
      assert.strictEqual((readyEv.toolCall.arguments as Record<string, unknown>).path, 'src/main.ts');
      assert.strictEqual((readyEv.toolCall.arguments as Record<string, unknown>).content, 'console.log(1);');

      passed++;
      details.push('PASS: Tool calling chunk assembly into verified arguments');
    } catch (err) {
      failed++;
      details.push(`FAIL: Tool calling chunk assembly - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Test Error Normalization (429 Rate Limit)
    try {
      mockAdapter.setBehavior({ mode: 'error', errorType: 'rate_limit' });
      const events: UnifiedStreamEvent[] = [];
      for await (const ev of model.stream({ modelId: 'mock-v1', messages: [] })) {
        events.push(ev);
      }
      const errEv = events.find((e) => e.type === 'error');
      assert.ok(errEv && errEv.type === 'error');
      assert.strictEqual(errEv.error.code, 'RATE_LIMITED');
      assert.strictEqual(errEv.error.statusCode, 429);
      assert.strictEqual(errEv.error.retryable, true);

      passed++;
      details.push('PASS: Error normalization (RATE_LIMITED code, 429 status, retryable=true)');
    } catch (err) {
      failed++;
      details.push(`FAIL: Error normalization - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Test Cancellation with AbortSignal
    try {
      mockAdapter.setBehavior({ mode: 'delay_cancel', delayMs: 10 });
      const controller = new AbortController();
      controller.abort(); // pre-abort

      const events: UnifiedStreamEvent[] = [];
      for await (const ev of model.stream({ modelId: 'mock-v1', messages: [], signal: controller.signal })) {
        events.push(ev);
      }

      const errEv = events.find((e) => e.type === 'error');
      assert.ok(errEv && errEv.type === 'error');
      assert.strictEqual(errEv.error.code, 'ABORTED');

      passed++;
      details.push('PASS: Request cancellation via AbortSignal');
    } catch (err) {
      failed++;
      details.push(`FAIL: Request cancellation - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 5. Test Hard Capability Rejection in CapabilityNegotiator
    try {
      const toolDisabledModel: ModelDescriptor = {
        ...testDescriptor,
        modelId: 'tool-disabled-v1',
        capabilities: { ...testDescriptor.capabilities, toolCalling: 'unsupported' },
      };

      const toolReqs: ModelRequirements = { toolCalling: 'required' };
      const evalResult = CapabilityNegotiator.evaluate(toolDisabledModel, toolReqs);
      assert.strictEqual(evalResult.eligible, false);
      assert.ok(evalResult.rejectionReasons.some((r) => r.includes('does not support required tool calling')));

      // Test selectBest throwing on all ineligible
      assert.throws(
        () => CapabilityNegotiator.selectBest([toolDisabledModel], toolReqs),
        /No model satisfies the required capabilities/
      );

      passed++;
      details.push('PASS: Hard capability filtering and rejection');
    } catch (err) {
      failed++;
      details.push(`FAIL: Capability rejection - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 6. Test CompatibilityBridge to BaseProvider v1
    try {
      mockAdapter.setBehavior({ mode: 'text', text: 'Bridge stream test' });
      const bridged = CompatibilityBridge.create('mock-conn', 'mock-v1');
      assert.strictEqual(bridged.model, 'mock-v1');
      assert.strictEqual(bridged.provider.name, 'mock-provider');

      const legacyEvents: StreamEvent[] = [];
      const stream = bridged.provider.streamChat({
        model: 'mock-v1',
        systemPrompt: 'You are a test assistant',
        messages: [{ id: '1', role: 'user', content: 'Ping', timestamp: Date.now() }],
        tools: [],
      });

      for await (const ev of stream) {
        legacyEvents.push(ev);
      }

      const textDeltas = legacyEvents.filter((e) => e.type === 'text_delta');
      assert.ok(textDeltas.length > 0);
      const finish = legacyEvents.find((e) => e.type === 'finish');
      assert.ok(finish);

      passed++;
      details.push('PASS: CompatibilityBridge event translation (v2 -> v1 StreamEvent)');
    } catch (err) {
      failed++;
      details.push(`FAIL: CompatibilityBridge - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 7. Test ProviderFactory Integration for All Builtin Providers
    try {
      const anthropicRes = ProviderFactory.create('anthropic');
      assert.strictEqual(anthropicRes.model, 'claude-3-7-sonnet-20250219');
      assert.strictEqual(anthropicRes.provider.name, 'anthropic');

      const openaiRes = ProviderFactory.create('openai');
      assert.strictEqual(openaiRes.model, 'gpt-4o');
      assert.strictEqual(openaiRes.provider.name, 'openai');

      const deepseekRes = ProviderFactory.create('deepseek');
      assert.strictEqual(deepseekRes.model, 'deepseek-chat');
      assert.strictEqual(deepseekRes.provider.name, 'deepseek');

      const ollamaRes = ProviderFactory.create('ollama');
      assert.strictEqual(ollamaRes.model, 'llama3.3');
      assert.strictEqual(ollamaRes.provider.name, 'ollama');

      const geminiRes = ProviderFactory.create('gemini');
      assert.strictEqual(geminiRes.model, 'gemini-2.5-flash');
      assert.strictEqual(geminiRes.provider.name, 'google');

      passed++;
      details.push('PASS: ProviderFactory integration with ConnectionRegistry & ProviderRegistry');
    } catch (err) {
      failed++;
      details.push(`FAIL: ProviderFactory integration - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 8. Test OpenAIResponsesAdapter Registration
    try {
      const responsesAdapter = ProviderRegistry.get('openai-responses');
      assert.ok(responsesAdapter, 'Expected openai-responses adapter to be registered');
      assert.strictEqual(responsesAdapter.protocolId, 'openai-responses');
      passed++;
      details.push('PASS: OpenAIResponsesAdapter protocol registration');
    } catch (err) {
      failed++;
      details.push(`FAIL: OpenAIResponsesAdapter registration - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 9. Test OpenAI-Compatible Gateway Profiles
    try {
      const openrouter = ConnectionRegistry.get('openrouter-main');
      assert.ok(openrouter);
      assert.strictEqual(openrouter.providerId, 'openrouter');
      assert.strictEqual(openrouter.baseURL, 'https://openrouter.ai/api/v1');

      const vllm = ConnectionRegistry.get('vllm-local');
      assert.ok(vllm);
      assert.ok(vllm.allowedHosts && vllm.allowedHosts.includes('localhost'));

      const lmstudio = ConnectionRegistry.get('lmstudio-local');
      assert.ok(lmstudio);
      assert.strictEqual(lmstudio.baseURL, 'http://localhost:1234/v1');

      passed++;
      details.push('PASS: OpenAI-compatible gateway profiles (openrouter, vllm, lmstudio)');
    } catch (err) {
      failed++;
      details.push(`FAIL: OpenAI-compatible gateway profiles - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 10. Test ConnectionConfigLoader
    try {
      const tmpConfigPath = path.join(os.tmpdir(), `test-connections-${Date.now()}.json`);
      const sampleConfig = {
        connections: {
          'custom-cluster-vllm': {
            providerId: 'vllm-cluster',
            protocolId: 'openai-chat-completions',
            baseURL: 'http://127.0.0.1:8080/v1',
            defaultModelId: 'Qwen/Qwen2.5-72B',
            allowedHosts: ['127.0.0.1'],
          },
        },
      };
      fs.writeFileSync(tmpConfigPath, JSON.stringify(sampleConfig, null, 2), 'utf-8');

      const loaded = ConnectionConfigLoader.loadFromFile(tmpConfigPath);
      assert.strictEqual(loaded, 1);

      const registered = ConnectionRegistry.get('custom-cluster-vllm');
      assert.ok(registered);
      assert.strictEqual(registered.defaultModelId, 'Qwen/Qwen2.5-72B');

      // Cleanup
      fs.unlinkSync(tmpConfigPath);

      passed++;
      details.push('PASS: ConnectionConfigLoader dynamic user profile registration');
    } catch (err) {
      failed++;
      details.push(`FAIL: ConnectionConfigLoader - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 11. Test ModelDiscovery Heuristic Parsing
    try {
      const mockRawModels = [
        { id: 'qwen2.5-vl-72b-instruct' },
        { id: 'deepseek-r1-distill-qwen-32b' },
        { id: 'text-embedding-3-large' },
      ];

      const discovered = ModelDiscovery.parseAndRegisterModels('mock-discovery-provider', mockRawModels);
      assert.strictEqual(discovered.length, 3);

      const vlModel = discovered.find((m) => m.modelId.includes('vl'));
      assert.ok(vlModel && vlModel.inputModalities.includes('image'), 'Expected vision model to support image modality');

      const reasonerModel = discovered.find((m) => m.modelId.includes('r1'));
      assert.ok(reasonerModel && reasonerModel.capabilities.reasoningControl === 'supported', 'Expected r1 model to support reasoningControl');

      const embedModel = discovered.find((m) => m.modelId.includes('embedding'));
      assert.ok(embedModel && embedModel.capabilities.toolCalling === 'unsupported', 'Expected embedding model to disable toolCalling');

      passed++;
      details.push('PASS: ModelDiscovery heuristic capability inference');
    } catch (err) {
      failed++;
      details.push(`FAIL: ModelDiscovery heuristic parsing - ${err instanceof Error ? err.message : String(err)}`);
    }

    // 12. Test ProviderHealthChecker & GatewayFormatter
    try {
      const missingKeyConn = {
        id: 'test-missing-key',
        providerId: 'unconfigured-ai',
        protocolId: 'openai-chat-completions',
        apiKeyEnv: 'DEFINITELY_NONEXISTENT_KEY_12345',
      };
      ConnectionRegistry.register(missingKeyConn);

      const healthRes = await ProviderHealthChecker.check(missingKeyConn);
      assert.strictEqual(healthRes.status, 'missing_config');
      assert.strictEqual(healthRes.stages.configured, false);

      const listOutput = GatewayFormatter.formatModelsList('anthropic');
      assert.ok(listOutput.includes('claude-3-7-sonnet'));

      const inspectOutput = GatewayFormatter.formatModelInspect('openai', 'gpt-4o');
      assert.ok(inspectOutput.includes('Model:          gpt-4o'));
      assert.ok(inspectOutput.includes('Tools:          supported'));

      const providersOutput = GatewayFormatter.formatProvidersList();
      assert.ok(providersOutput.includes('anthropic-main'));
      assert.ok(providersOutput.includes('openrouter-main'));

      passed++;
      details.push('PASS: ProviderHealthChecker & GatewayFormatter inspection outputs');
    } catch (err) {
      failed++;
      details.push(`FAIL: ProviderHealthChecker & GatewayFormatter - ${err instanceof Error ? err.message : String(err)}`);
    }

    return { passed, failed, details };
  }
}
