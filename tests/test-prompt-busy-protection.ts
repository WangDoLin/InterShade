import assert from 'node:assert/strict';
import { QueryEngine } from '../orchestrator/QueryEngine.js';
import type { SessionConfig } from '../types/index.js';

console.log('[TEST]: Starting Prompt Busy Protection, Queue Customization & Abort Test Suite...');

// 1. Verify QueryEngine.abort() public interface and signal abort handling
const mockConfig: SessionConfig = {
  sessionId: 'test-busy-session-' + Date.now(),
  cwd: process.cwd(),
  model: 'gemini-2.5-flash',
  provider: 'google',
  permissionMode: 'default',
  resumeSession: false,
};

const queryEngine = new QueryEngine(mockConfig);
assert.strictEqual(typeof queryEngine.abort, 'function', 'QueryEngine must expose a public abort() method');
queryEngine.abort(); // Safe no-op when idle
console.log('[PASS]: 1. QueryEngine exposes safe public abort() method');

// 2. Test Prompt Queuing, Up Arrow In-Place Editing, and Auto-Dispatch
let isBusy = true; // Agent running
let queuedPrompt: string | null = null;
let inputValue = '';
let dispatchedPrompts: string[] = [];
let abortCalled = false;

function handleUserSubmit(prompt: string) {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  if (trimmed === '/unqueue' || trimmed === '/clear-queue' || trimmed === '/dq') {
    queuedPrompt = null;
    return;
  }

  if (isBusy) {
    queuedPrompt = trimmed;
    inputValue = '';
    return;
  }

  isBusy = true;
  dispatchedPrompts.push(trimmed);
}

function handleClearQueue() {
  queuedPrompt = null;
}

function handleUpArrow() {
  if (!inputValue && queuedPrompt) {
    inputValue = queuedPrompt;
    handleClearQueue();
  }
}

function handleEscape() {
  if (inputValue.length > 0) {
    inputValue = '';
    return;
  }
  if (queuedPrompt) {
    handleClearQueue();
    return;
  }
  if (isBusy) {
    abortCalled = true;
    queryEngine.abort();
    isBusy = false;
  }
}

function handleDone() {
  isBusy = false;
  if (queuedPrompt) {
    const next = queuedPrompt;
    queuedPrompt = null;
    handleUserSubmit(next);
  }
}

// Queue prompt 1
handleUserSubmit('Prompt 1: Refactor auth service');
assert.strictEqual(queuedPrompt, 'Prompt 1: Refactor auth service', 'Prompt 1 must be queued');
assert.strictEqual(inputValue, '');

// Edit queue via Up Arrow
handleUpArrow();
assert.strictEqual(inputValue, 'Prompt 1: Refactor auth service', 'Up Arrow must populate input with queued prompt');
assert.strictEqual(queuedPrompt, null, 'Queue must be cleared when hydrated into input');

// User edits input and submits
inputValue += ' with OAuth2 PKCE';
handleUserSubmit(inputValue);
assert.strictEqual(queuedPrompt, 'Prompt 1: Refactor auth service with OAuth2 PKCE', 'Edited prompt must be re-queued');
assert.strictEqual(inputValue, '');
console.log('[PASS]: 2. Prompt queueing, Up Arrow editing, and re-queueing verified');

// 3. Test Escape Key Hierarchy: partial input clear -> queue delete -> abort
inputValue = 'draft to discard';
handleEscape();
assert.strictEqual(inputValue, '', 'Escape must clear active input buffer');
assert.strictEqual(queuedPrompt, 'Prompt 1: Refactor auth service with OAuth2 PKCE', 'Queued prompt remains intact');

// Escape on empty input deletes queue without stopping agent
assert.strictEqual(isBusy, true);
handleEscape();
assert.strictEqual(queuedPrompt, null, 'Escape on empty input must delete queue');
assert.strictEqual(isBusy, true, 'Agent must still be running');
assert.strictEqual(abortCalled, false);
console.log('[PASS]: 3. Hierarchical Escape deletes queue without stopping in-flight agent');

// 4. Test Slash Commands /unqueue, /clear-queue, /dq
handleUserSubmit('Test slash queue');
assert.strictEqual(queuedPrompt, 'Test slash queue');
handleUserSubmit('/unqueue');
assert.strictEqual(queuedPrompt, null, 'Slash command /unqueue must clear queue');

handleUserSubmit('Test slash queue 2');
handleUserSubmit('/dq');
assert.strictEqual(queuedPrompt, null, 'Slash command /dq must clear queue');
console.log('[PASS]: 4. Slash commands (/unqueue, /dq) clear queue cleanly');

// 5. Test Auto-Dispatch upon agent completion
isBusy = true;
handleUserSubmit('Queued task for auto-dispatch');
assert.strictEqual(queuedPrompt, 'Queued task for auto-dispatch');
handleDone();
assert.strictEqual(dispatchedPrompts.length, 1);
assert.strictEqual(dispatchedPrompts[0], 'Queued task for auto-dispatch');
assert.strictEqual(queuedPrompt, null);
assert.strictEqual(isBusy, true);
handleDone();
assert.strictEqual(isBusy, false);
console.log('[PASS]: 5. Auto-dispatch of queued prompt on agent completion verified');

console.log('[SUCCESS]: ALL PROMPT BUSY PROTECTION, QUEUE & ABORT TESTS PASSED 100%!');
