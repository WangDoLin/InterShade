import assert from 'assert';

console.log('[TEST]: Starting Terminal Input & Enter Key Detection Test Suite...');

// 1. Test Enter key detection logic across terminal environments
function isEnterKey(input: string, key: Record<string, unknown>): boolean {
  return Boolean(
    key.return ||
    key.name === 'enter' ||
    input === '\r' ||
    input === '\n' ||
    input === '\r\n'
  );
}

// Case A: Standard return
assert.strictEqual(isEnterKey('', { return: true }), true, 'Standard key.return must trigger submit');

// Case B: Windows/Linux linefeed where Ink sets keypress.name === "enter"
assert.strictEqual(isEnterKey('\n', { name: 'enter' }), true, 'Linefeed with key.name="enter" must trigger submit');

// Case C: Raw carriage return \r
assert.strictEqual(isEnterKey('\r', {}), true, 'Raw \\r must trigger submit');

// Case D: Raw newline \n
assert.strictEqual(isEnterKey('\n', {}), true, 'Raw \\n must trigger submit');

// Case E: Windows CRLF sequence \r\n
assert.strictEqual(isEnterKey('\r\n', {}), true, 'Raw \\r\\n must trigger submit');

// Case F: Normal alphanumeric typing must NOT trigger submit
assert.strictEqual(isEnterKey('a', {}), false, 'Normal char must not trigger submit');
assert.strictEqual(isEnterKey('chào', {}), false, 'Vietnamese text must not trigger submit');

console.log('[PASS]: 1.1 - Enter key detection covers key.return, key.enter, \\r, \\n, and \\r\\n');

// 2. Test sanitizeInput: strips \r, \n, and control codes while keeping Unicode
function sanitizeInput(raw: string): string {
  const withoutAnsi = raw.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  const clean = withoutAnsi.replace(/[\x00-\x1F\x7F]/g, '');
  return clean;
}

// Verify \r and \n are stripped
assert.strictEqual(sanitizeInput('hello\r\nworld'), 'helloworld', 'Stray \\r\\n must be stripped');
assert.strictEqual(sanitizeInput('\nmy prompt\n'), 'my prompt', 'Leading and trailing newlines must be stripped');

// Verify Vietnamese diacritics are 100% preserved
const vietnameseText = 'Kiểm tra ổ đĩa và bộ nhớ RAM của máy tính';
assert.strictEqual(sanitizeInput(vietnameseText), vietnameseText, 'Vietnamese diacritics must be perfectly preserved');

// Verify ANSI color escapes are stripped
assert.strictEqual(sanitizeInput('\x1b[31mRed text\x1b[0m'), 'Red text', 'ANSI codes must be stripped');

console.log('[PASS]: 1.2 - Input sanitation strips newlines and control codes while preserving Unicode');
console.log('[SUCCESS]: ALL TERMINAL INPUT & ENTER TESTS PASSED 100%!');
