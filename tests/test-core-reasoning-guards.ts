import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VerifyOnStopGuard } from '../engine/guards/VerifyOnStopGuard.js';
import { RepetitionGuard } from '../engine/guards/RepetitionGuard.js';
import { ContextMicroCompactor } from '../context/ContextMicroCompactor.js';
import type { UnifiedMessage } from '../types/index.js';

describe('Phase 1: Core Reasoning & Reliability Guards', () => {
  describe('VerifyOnStopGuard', () => {
    it('should ignore non-code files (markdown, txt, license)', () => {
      const guard = new VerifyOnStopGuard();
      const files = ['README.md', 'docs/notes.txt', 'LICENSE', 'data.csv'];
      const decision = guard.evaluate(files);

      assert.equal(decision.shouldBlock, false);
      assert.equal(decision.unverifiedFiles.length, 0);
    });

    it('should block completion and nudge when code files are modified without verification', () => {
      const guard = new VerifyOnStopGuard();
      const files = ['src/auth.ts', 'README.md'];
      const modTimestamp = Date.now();
      const decision = guard.evaluate(files, modTimestamp);

      assert.equal(decision.shouldBlock, true);
      assert.deepEqual(decision.unverifiedFiles, ['src/auth.ts']);
      assert.ok(decision.nudgePrompt?.includes('[VERIFY-ON-STOP GUARD POLICY]'));
      assert.ok(decision.nudgePrompt?.includes('src/auth.ts'));
    });

    it('should allow completion when verification occurred after file modification', () => {
      const guard = new VerifyOnStopGuard();
      const files = ['src/auth.ts'];
      const modTimestamp = 1000;
      guard.recordVerification(2000);

      const decision = guard.evaluate(files, modTimestamp);
      assert.equal(decision.shouldBlock, false);
    });

    it('should stop blocking after maxNudges limit is reached to avoid deadlocks', () => {
      const guard = new VerifyOnStopGuard({ maxNudges: 2 });
      const files = ['src/index.ts'];

      const d1 = guard.evaluate(files);
      assert.equal(d1.shouldBlock, true);

      const d2 = guard.evaluate(files);
      assert.equal(d2.shouldBlock, true);

      const d3 = guard.evaluate(files);
      assert.equal(d3.shouldBlock, false);
      assert.equal(d3.remainingNudges, 0);
    });
  });

  describe('RepetitionGuard', () => {
    it('should detect consecutive identical tool calls', () => {
      const guard = new RepetitionGuard(10, 3);
      guard.record('file_read', { path: 'src/index.ts' });
      guard.record('file_read', { path: 'src/index.ts' });
      const r3 = guard.record('file_read', { path: 'src/index.ts' });

      assert.equal(r3.isLooping, true);
      assert.equal(r3.loopType, 'consecutive');
      assert.equal(r3.repeatCount, 3);
      assert.ok(r3.interventionPrompt?.includes('REPETITION GUARD INTERVENTION'));
    });

    it('should detect alternating tool cycles (A -> B -> A -> B)', () => {
      const guard = new RepetitionGuard(10, 3);
      guard.record('file_edit', { path: 'src/app.ts', code: 'x' });
      guard.record('run_shell_command', { command: 'tsc' });
      guard.record('file_edit', { path: 'src/app.ts', code: 'x' });
      const cycleResult = guard.record('run_shell_command', { command: 'tsc' });

      assert.equal(cycleResult.isLooping, true);
      assert.equal(cycleResult.loopType, 'alternating_cycle');
      assert.ok(cycleResult.interventionPrompt?.includes('CYCLICAL LOOP DETECTED'));
      assert.deepEqual(cycleResult.cycleSignature, ['file_edit', 'run_shell_command']);
    });

    it('should detect runaway text stream repetition', () => {
      // 1. Repeating line test
      const singleLine = 'This is an identical error line echoing infinitely.\n';
      const repeatedText = singleLine.repeat(15);
      const echo1 = RepetitionGuard.isTextRepetitionDominated(repeatedText);
      assert.equal(echo1.isEchoing, true);

      // 2. Normal diverse prose should not trigger
      const normalText = 'This is step 1 of the implementation plan.\nWe will proceed to edit file A and then run tests.\nAll tests passed successfully with 0 errors.\nFinal summary prepared.';
      const echo2 = RepetitionGuard.isTextRepetitionDominated(normalText);
      assert.equal(echo2.isEchoing, false);
    });
  });

  describe('ContextMicroCompactor', () => {
    it('should micro-compact verbose tool results in older turns while preserving recent ones', () => {
      const compactor = new ContextMicroCompactor({ maxContextTokens: 100000 });
      const verboseContent = Array.from({ length: 40 }, (_, i) => `Log line ${i}: detailed trace output`).join('\n');

      const messages: UnifiedMessage[] = [
        { id: '1', role: 'system', content: 'You are an agent.', timestamp: 1 },
        { id: '2', role: 'user', content: 'Build the project.', timestamp: 2 },
        {
          id: '3',
          role: 'tool',
          content: verboseContent,
          toolResult: { toolCallId: 'c1', toolName: 'run_shell_command', isError: false, content: verboseContent },
          timestamp: 3,
        },
        { id: '4', role: 'assistant', content: 'I see the build logs.', timestamp: 4 },
        { id: '5', role: 'user', content: 'What next?', timestamp: 5 },
        { id: '6', role: 'assistant', content: 'Next step.', timestamp: 6 },
      ];

      const res = compactor.optimize(messages);
      assert.equal(res.wasCompacted, true);
      assert.ok(res.tokensSaved > 0);

      // The compacted tool message should contain the omitted notice
      const toolMsg = res.messages.find((m) => m.id === '3');
      assert.ok(toolMsg?.content.includes('Micro-compacted'));
      assert.ok(toolMsg?.content.includes('lines omitted'));
    });
  });
});
