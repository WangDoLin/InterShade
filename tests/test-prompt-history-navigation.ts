import assert from 'assert';
import { randomUUID } from 'crypto';
import type { UnifiedMessage } from '../types/index.js';
import { extractPromptTurns, truncatePromptText } from '../ui/utils/turnExtractor.js';
import { parseSgrMouseEvent, TerminalMouseManager } from '../ui/services/TerminalMouseManager.js';

console.log('=== TEST SUITE: Prompt History Navigation & Rewind Viewport ===\n');

// ----------------------------------------------------------------------------
// Test 1: truncatePromptText
// ----------------------------------------------------------------------------
console.log('[Test 1] truncatePromptText utility');
{
  assert.strictEqual(truncatePromptText('Short text', 20), 'Short text');
  assert.strictEqual(
    truncatePromptText('Multi\nline\r\nprompt   with   spaces', 40),
    'Multi line prompt with spaces'
  );
  const truncated = truncatePromptText('This is a very long prompt that definitely exceeds the limit', 20);
  assert.strictEqual(truncated.length <= 20, true);
  assert.strictEqual(truncated.endsWith('...'), true);
  console.log('  ✔ Truncation handles short, multiline, and long strings accurately.');
}

// ----------------------------------------------------------------------------
// Test 2: extractPromptTurns
// ----------------------------------------------------------------------------
console.log('\n[Test 2] extractPromptTurns message grouping');
{
  const mockMessages: UnifiedMessage[] = [
    {
      id: 'msg-sys',
      role: 'system',
      content: 'System prompt instructions',
      timestamp: 1000,
    },
    {
      id: 'msg-u1',
      role: 'user',
      content: 'Create authentication service',
      timestamp: 1010,
    },
    {
      id: 'msg-a1-thought',
      role: 'assistant',
      content: 'I will analyze requirements',
      thought: 'Need to inspect existing user models',
      timestamp: 1020,
    },
    {
      id: 'msg-t1',
      role: 'tool',
      content: '{"diff": "@@ -0,0 +1,10 @@"}',
      toolResult: {
        toolCallId: 'call-1',
        toolName: 'write_to_file',
        content: 'Created auth.ts',
        isError: false,
      },
      timestamp: 1030,
    },
    {
      id: 'msg-a1-final',
      role: 'assistant',
      content: 'Created auth service successfully',
      timestamp: 1040,
    },
    {
      id: 'msg-u2',
      role: 'user',
      content: 'Add unit tests for auth service',
      timestamp: 2000,
    },
    {
      id: 'msg-a2',
      role: 'assistant',
      content: 'All unit tests added and passing',
      timestamp: 2010,
    },
    {
      id: 'msg-u3',
      role: 'user',
      content: 'Optimize token refresh query',
      timestamp: 3000,
    },
  ];

  const turns = extractPromptTurns(mockMessages);

  assert.strictEqual(turns.length, 3, 'Should extract exactly 3 distinct turns');

  // Turn 1 assertions
  assert.strictEqual(turns[0].turnIndex, 1);
  assert.strictEqual(turns[0].promptId, 'msg-u1');
  assert.strictEqual(turns[0].promptText, 'Create authentication service');
  assert.strictEqual(turns[0].messages.length, 4, 'Turn 1 should include user, thought, tool, assistant');

  // Turn 2 assertions
  assert.strictEqual(turns[1].turnIndex, 2);
  assert.strictEqual(turns[1].promptId, 'msg-u2');
  assert.strictEqual(turns[1].promptText, 'Add unit tests for auth service');
  assert.strictEqual(turns[1].messages.length, 2, 'Turn 2 should include user and assistant');

  // Turn 3 assertions
  assert.strictEqual(turns[2].turnIndex, 3);
  assert.strictEqual(turns[2].promptId, 'msg-u3');
  assert.strictEqual(turns[2].messages.length, 1, 'Turn 3 (in-progress) should include user prompt');

  console.log('  ✔ Correctly segmented conversation into discrete turns with full context.');
}

// ----------------------------------------------------------------------------
// Test 3: parseSgrMouseEvent
// ----------------------------------------------------------------------------
console.log('\n[Test 3] parseSgrMouseEvent ANSI SGR mode 1006 parser');
{
  // Valid Left Mouse Press at Col 35, Row 2
  const press = parseSgrMouseEvent('\x1b[<0;35;2M');
  assert.notStrictEqual(press, null);
  assert.strictEqual(press?.button, 0);
  assert.strictEqual(press?.col, 35);
  assert.strictEqual(press?.row, 2);
  assert.strictEqual(press?.isPress, true);
  assert.strictEqual(press?.isRelease, false);

  // Valid Left Mouse Release at Col 35, Row 2
  const release = parseSgrMouseEvent('\x1b[<0;35;2m');
  assert.notStrictEqual(release, null);
  assert.strictEqual(release?.isPress, false);
  assert.strictEqual(release?.isRelease, true);

  // Non-mouse inputs should safely return null
  assert.strictEqual(parseSgrMouseEvent('normal keystroke'), null);
  assert.strictEqual(parseSgrMouseEvent('\x1b[A'), null);
  assert.strictEqual(parseSgrMouseEvent(''), null);

  console.log('  ✔ SGR escape sequences parsed accurately with press/release flags.');
}

// ----------------------------------------------------------------------------
// Test 4: TerminalMouseManager Hit-Box Registration and Event Routing
// ----------------------------------------------------------------------------
console.log('\n[Test 4] TerminalMouseManager Hit-Box Registration');
{
  const mouseMgr = TerminalMouseManager.getInstance();
  let clickedTurn: number | null = null;
  let clickedReturnToBottom = false;

  // Register Turn #2 pill
  mouseMgr.registerZone({
    id: 'pill-turn-2',
    minCol: 20,
    maxCol: 40,
    minRow: 1,
    maxRow: 3,
    onClick: () => {
      clickedTurn = 2;
    },
  });

  // Register Return to Bottom bar
  mouseMgr.registerZone({
    id: 'return-bar',
    minCol: 1,
    maxCol: 80,
    minRow: 20,
    maxRow: 24,
    onClick: () => {
      clickedReturnToBottom = true;
    },
  });

  // 1. Click inside Turn #2 pill
  const handledPill = mouseMgr.handleRawInput('\x1b[<0;30;2M');
  assert.strictEqual(handledPill, true);
  assert.strictEqual(clickedTurn, 2, 'Should trigger Turn #2 click');

  // 2. Click outside Turn #2 pill on row 2
  clickedTurn = null;
  const handledOutside = mouseMgr.handleRawInput('\x1b[<0;55;2M');
  assert.strictEqual(handledOutside, false);
  assert.strictEqual(clickedTurn, null);

  // 3. Click inside Return to Bottom bar
  const handledReturn = mouseMgr.handleRawInput('\x1b[<0;40;22M');
  assert.strictEqual(handledReturn, true);
  assert.strictEqual(clickedReturnToBottom, true, 'Should trigger Return to Bottom click');

  // 4. Unregister zone
  mouseMgr.unregisterZone('pill-turn-2');
  const handledAfterUnreg = mouseMgr.handleRawInput('\x1b[<0;30;2M');
  assert.strictEqual(handledAfterUnreg, false);

  mouseMgr.clearZones();
  console.log('  ✔ Hit-box coordinate checking and zone unregistration pass.');
}

// ----------------------------------------------------------------------------
// Test 5: State Machine Simulation (Live Mode <-> Inspection Mode)
// ----------------------------------------------------------------------------
console.log('\n[Test 5] State Machine: Live Mode <-> Inspection Mode Transitions');
{
  let viewingTurnIndex: number | null = null;
  const turnsCount = 4;

  const selectTurn = (index: number) => {
    if (index >= 1 && index <= turnsCount) {
      viewingTurnIndex = index;
    }
  };

  const returnToBottom = () => {
    viewingTurnIndex = null;
  };

  // Initial state: Live Working Mode
  assert.strictEqual(viewingTurnIndex, null, 'Must start in Live Working Mode');

  // User clicks or presses Alt+2 to inspect Turn 2
  selectTurn(2);
  assert.strictEqual(viewingTurnIndex, 2, 'Must enter Inspection Mode for Turn 2');

  // User switches to Turn 3
  selectTurn(3);
  assert.strictEqual(viewingTurnIndex, 3, 'Must switch inspection to Turn 3');

  // User presses Esc, 'B', or clicks ReturnToBottomBar
  returnToBottom();
  assert.strictEqual(viewingTurnIndex, null, 'Must restore Live Working Mode');

  console.log('  ✔ State machine transitions between Live and Inspection mode cleanly.');
}

console.log('\n===============================================================');
console.log('🎉 ALL TESTS PASSED SUCCESSFULLY (5/5 PASS)');
console.log('===============================================================');
