import assert from 'assert';
import { MultiTierCompactor } from '../context/MultiTierCompactor.js';
import { ContinuousStateMachine } from '../engine/ContinuousStateMachine.js';
import type { UnifiedMessage } from '../types/index.js';
import { randomUUID } from 'crypto';

console.log('[TEST]: Starting State Machine & Multi-Tier Compactor Tests...');

// 1. Test MultiTierCompactor Layer 1 (Micro-compact)
const messagesWithVerboseTool: UnifiedMessage[] = [
  { id: '1', role: 'user', content: 'Run compilation check', timestamp: Date.now() },
  {
    id: '2',
    role: 'tool',
    toolCallId: 'c1',
    content: Array.from({ length: 30 }, (_, i) => `TS100${i}: compiler warning detail message here`).join('\n'),
    toolResult: {
      toolCallId: 'c1',
      toolName: 'run_shell_command',
      isError: false,
      content: Array.from({ length: 30 }, (_, i) => `TS100${i}: compiler warning detail message here`).join('\n'),
    },
    timestamp: Date.now(),
  },
  { id: '3', role: 'user', content: 'What is next?', timestamp: Date.now() },
  { id: '4', role: 'assistant', content: 'Checking remaining tasks.', timestamp: Date.now() },
  { id: '5', role: 'user', content: 'Proceed', timestamp: Date.now() },
  { id: '6', role: 'assistant', content: 'Understood.', timestamp: Date.now() },
  { id: '7', role: 'user', content: 'Done?', timestamp: Date.now() },
  { id: '8', role: 'assistant', content: 'Yes, complete.', timestamp: Date.now() },
];

const microRes = MultiTierCompactor.applyMicroCompact(messagesWithVerboseTool);
assert.strictEqual(microRes.report.layer, 'micro');
assert.ok(microRes.messages[1].content.includes('Micro-compacted'));
console.log('[PASS]: Layer 1 Micro-compact verified');

// 2. Test MultiTierCompactor Layer 2 (Context Collapse)
const collapseRes = MultiTierCompactor.applyContextCollapse(messagesWithVerboseTool);
assert.strictEqual(collapseRes.report.layer, 'collapse');
console.log('[PASS]: Layer 2 Context Collapse verified');

// 3. Test MultiTierCompactor Layer 3 (Auto-compact with reconstruction)
const autoRes = MultiTierCompactor.applyAutoCompact(messagesWithVerboseTool, {
  activeTasksSummary: '- Task 1: Complete\n- Task 2: In progress',
  recentlyTouchedFiles: ['src/index.ts', 'src/App.tsx'],
});
assert.strictEqual(autoRes.report.layer, 'auto');
const summaryMsg = autoRes.messages.find((m) => m.content.includes('# Conversation Compaction Boundary'));
assert.ok(summaryMsg);
assert.ok(summaryMsg.content.includes('src/index.ts'));
assert.ok(summaryMsg.content.includes('Active Task Checklist'));
console.log('[PASS]: Layer 3 Auto-compact with Context Reconstruction verified');

// 4. Test MultiTierCompactor Layer 4 (Reactive 413 Compact)
const reactiveRes = MultiTierCompactor.applyReactiveCompact(messagesWithVerboseTool, {
  recentlyTouchedFiles: ['src/App.tsx'],
});
assert.strictEqual(reactiveRes.report.layer, 'reactive');
assert.ok(reactiveRes.messages[0].content.includes('REACTIVE 413 EMERGENCY COMPACTION'));
console.log('[PASS]: Layer 4 Reactive 413 Compact verified');

// 5. Test ContinuousStateMachine Pre-Context Preparation
const sm = new ContinuousStateMachine({
  initialProvider: 'anthropic',
  initialModel: 'claude-3-7-sonnet-20250219',
  maxTokens: 8192,
  contextWindowBudget: 500, // Small budget to trigger auto-compact
});

const prepared = sm.prepareContext(messagesWithVerboseTool, {
  recentlyTouchedFiles: ['src/engine.ts'],
});
assert.ok(prepared.compactionApplied);
console.log(`[PASS]: StateMachine context preparation triggered: ${prepared.compactionApplied}`);

console.log('[SUCCESS]: All State Machine & Multi-Tier Compactor Tests PASSED!');
