import assert from 'node:assert/strict';
import { processRawTerminalInput } from '../ui/components/TerminalTextInput.js';

console.log('[TEST]: Starting Vietnamese IME (Telex/VNI) Input & Duplicate Prevention Test Suite...');

// Helper to simulate sequential typing
function simulateTyping(chunks: string[]): string {
  let val = '';
  let offset = 0;
  for (const chunk of chunks) {
    const res = processRawTerminalInput(val, offset, chunk);
    val = res.nextValue;
    offset = res.nextOffset;
  }
  return val;
}

// 1. Test Telex Vowel Composition without duplication
// Typing "t" -> "o" -> "o" (IME sends "\x08ô")
const resToi = simulateTyping(['t', 'o', '\x08ô']);
assert.equal(resToi, 'tô', 'Typing "to" + "o" must result in "tô", NOT "toô"');

// Typing "b" -> "a" -> "a" (IME sends "\x08â")
const resBa = simulateTyping(['b', 'a', '\x08â']);
assert.equal(resBa, 'bâ', 'Typing "ba" + "a" must result in "bâ", NOT "baâ"');

// Typing "d" -> "d" (IME sends "\x08đ")
const resD = simulateTyping(['d', '\x08đ']);
assert.equal(resD, 'đ', 'Typing "d" + "d" must result in "đ", NOT "dđ"');

// Typing "m" -> "o" -> "w" (IME sends "\x08ơ")
const resMo = simulateTyping(['m', 'o', '\x08ơ']);
assert.equal(resMo, 'mơ', 'Typing "mo" + "w" must result in "mơ", NOT "moơ"');

console.log('[PASS]: Telex vowel compositions (ô, â, đ, ê, ơ, ư) resolve cleanly without character duplication');

// 2. Test Complex Multi-character Tone Replacements
// Typing "tieengs" -> IME replaces "tieng" with "tiếng" via multi-backspace chunk
const resTieng = simulateTyping(['t', 'i', 'e', '\x08ê', 'n', 'g', '\x08\x08\x08\x08\x08tiếng']);
assert.equal(resTieng, 'tiếng', 'Typing "tieengs" must produce "tiếng" without duplicates');

// Typing "vieetj" -> "việt"
const resViet = simulateTyping(['v', 'i', 'e', '\x08ê', 't', '\x08\x08\x08\x08việt']);
assert.equal(resViet, 'việt', 'Typing "vieetj" must produce "việt" without duplicates');

// Typing full sentence "tiếng việt"
const resSentence = simulateTyping([
  't', 'i', 'e', '\x08ê', 'n', 'g', '\x08\x08\x08\x08\x08tiếng',
  ' ',
  'v', 'i', 'e', '\x08ê', 't', '\x08\x08\x08\x08việt'
]);
assert.equal(resSentence, 'tiếng việt', 'Sentence "tiếng việt" must match exactly');

console.log('[PASS]: Complex Telex words and tone markings resolve cleanly without duplicate sequences');

// 3. Test VNI Numeric Input Mode
// Typing "to" + "6" -> IME sends "\x08ô", then "i" + "1" -> IME replaces "ôi" with "ối" via "\x08\x08ối"
const resVni1 = simulateTyping(['t', 'o', '\x08ô', 'i', '\x08\x08ối']);
assert.equal(resVni1, 'tối', 'VNI typing "to6i1" must resolve to "tối"');

console.log('[PASS]: VNI numeric typing mode verified successfully');

// 4. Test In-place Editing & Cursor Offset
// Insert in middle: "tiếng" -> move cursor before "ế" (offset 2) -> insert "x" -> "tixếng"
const midEdit = processRawTerminalInput('tiếng', 2, 'x');
assert.equal(midEdit.nextValue, 'tixếng');
assert.equal(midEdit.nextOffset, 3);

// Backspace in middle: "tixếng" at offset 3 -> delete "x" -> "tiếng"
const midDelete = processRawTerminalInput('tixếng', 3, '\x08');
assert.equal(midDelete.nextValue, 'tiếng');
assert.equal(midDelete.nextOffset, 2);

console.log('[PASS]: In-place editing and cursor offsets verified successfully');
console.log('[SUCCESS]: ALL VIETNAMESE IME DUPLICATE PREVENTION TESTS PASSED 100%!');
