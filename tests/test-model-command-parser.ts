import assert from 'node:assert';
import { CommandRegistry, registerBuiltinCommands } from '../cli/commands/index.js';
import { ConnectionRegistry } from '../providers/core/ConnectionRegistry.js';
import { QueryEngine } from '../orchestrator/QueryEngine.js';

async function testModelCommand() {
  console.log('--- Testing /model argument parsing and provider resolution ---');

  const registry = new CommandRegistry();
  registerBuiltinCommands(registry);

  const modelCmd = registry.get('model');
  assert.ok(modelCmd, 'modelCommand must be registered in CommandRegistry');

  // Test 1: /model openai ag/gemini-3.8-flash-high
  {
    const sessionState: Record<string, unknown> = {};
    const res = await (modelCmd as any).execute({
      cwd: process.cwd(),
      sessionState,
      args: ['openai', 'ag/gemini-3.8-flash-high'],
    });
    console.log('Test 1 result:', res);
    assert.strictEqual(sessionState.provider, 'openai', 'Provider should be openai');
    assert.strictEqual(sessionState.model, 'ag/gemini-3.8-flash-high', 'Model should be ag/gemini-3.8-flash-high');
    assert.ok(res.includes('ag/gemini-3.8-flash-high'), 'Output includes model');
    assert.ok(res.includes('openai'), 'Output includes provider');
  }

  // Test 2: /model ag/gemini-3.8-flash-high openai (swapped)
  {
    const sessionState: Record<string, unknown> = {};
    const res = await (modelCmd as any).execute({
      cwd: process.cwd(),
      sessionState,
      args: ['ag/gemini-3.8-flash-high', 'openai'],
    });
    console.log('Test 2 result:', res);
    assert.strictEqual(sessionState.provider, 'openai', 'Provider should be openai');
    assert.strictEqual(sessionState.model, 'ag/gemini-3.8-flash-high', 'Model should be ag/gemini-3.8-flash-high');
  }

  // Test 3: /model openai:ag/gemini-3.8-flash-high (colon prefix)
  {
    const sessionState: Record<string, unknown> = {};
    const res = await (modelCmd as any).execute({
      cwd: process.cwd(),
      sessionState,
      args: ['openai:ag/gemini-3.8-flash-high'],
    });
    console.log('Test 3 result:', res);
    assert.strictEqual(sessionState.provider, 'openai', 'Provider should be openai');
    assert.strictEqual(sessionState.model, 'ag/gemini-3.8-flash-high', 'Model should be ag/gemini-3.8-flash-high');
  }

  // Test 4: /model ag/gemini-3.8-flash-high (single model argument with 9Router proxy prefix)
  {
    const sessionState: Record<string, unknown> = {};
    const res = await (modelCmd as any).execute({
      cwd: process.cwd(),
      sessionState,
      args: ['ag/gemini-3.8-flash-high'],
    });
    console.log('Test 4 result:', res);
    assert.strictEqual(sessionState.provider, 'openai', 'Provider should be openai for 9Router model');
    assert.strictEqual(sessionState.model, 'ag/gemini-3.8-flash-high', 'Model should be ag/gemini-3.8-flash-high');
  }

  // Test 5: ConnectionRegistry fallback and resolution
  {
    const conn = ConnectionRegistry.findByProvider('ag/gemini-3.8-flash-high');
    assert.ok(conn, 'ConnectionRegistry should resolve 9Router model prefix to openai profile');
    assert.strictEqual(conn.providerId, 'openai');
  }

  // Test 6: QueryEngine.updateSessionModel self-healing
  {
    const qe = new QueryEngine({
      sessionId: 'test-self-heal-' + Date.now(),
      resumeSession: false,
      provider: 'openai',
      model: 'gpt-4o',
      cwd: process.cwd(),
      maxTokens: 10000,
      maxTurns: 5,
      permissionMode: 'default',
      proofMode: false,
    });

    // Pass inverted args
    qe.updateSessionModel('ag/gemini-3.8-flash-high', 'openai');
    const state = qe.getSessionState();
    console.log('Test 6 self-healed state:', state.provider, state.model);
    assert.strictEqual(state.provider, 'openai', 'Self-healing should swap provider back to openai');
    assert.strictEqual(state.model, 'ag/gemini-3.8-flash-high', 'Self-healing should swap model back to ag/gemini-3.8-flash-high');
  }

  console.log('All /model parser and self-healing tests passed successfully!');
}

testModelCommand().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
