import assert from 'node:assert';
import { CanonicalJson } from '../engine/verification/CanonicalJson.js';

console.log('[TEST]: Starting RFC 8785 (JCS) Test Vectors Suite...');

// 1. ASCII Keys Sorting
console.log('--- 1. ASCII Keys Sorting ---');
const asciiObj = {
  z: 1,
  a: 2,
  m: 3,
  aa: 4,
};
const asciiExpected = '{"a":2,"aa":4,"m":3,"z":1}';
assert.strictEqual(CanonicalJson.stringify(asciiObj), asciiExpected);
console.log('[PASS]: ASCII keys sorted strictly lexicographically.');

// 2. Unicode Keys Sorting (UTF-16 Code Units)
console.log('--- 2. Unicode Keys Sorting ---');
// In UTF-16 code units:
// 'A' = 0x0041, 'z' = 0x007A, 'ä' = 0x00E4, '€' = 0x20AC, '𝄞' = 0xD834 0xDD1E
const unicodeObj = {
  '€': 'euro',
  'ä': 'a-umlaut',
  'z': 'ascii-z',
  'A': 'ascii-A',
  '𝄞': 'musical-clef',
};
const unicodeCanonical = CanonicalJson.stringify(unicodeObj);
const expectedUnicode = '{"A":"ascii-A","z":"ascii-z","ä":"a-umlaut","€":"euro","𝄞":"musical-clef"}';
assert.strictEqual(unicodeCanonical, expectedUnicode);
console.log('[PASS]: Unicode keys sorted strictly by UTF-16 code units.');

// 3. Emoji and Surrogate Pairs in Values
console.log('--- 3. Emoji and Surrogate Pairs in Values ---');
const emojiObj = {
  greeting: 'Xin chào thế giới 🚀✨',
  symbols: 'Alpha β Gamma γ Delta δ',
};
const emojiCanonical = CanonicalJson.stringify(emojiObj);
assert.ok(emojiCanonical.includes('🚀✨'), 'Emoji must remain literal UTF-8 in canonical output');
assert.ok(emojiCanonical.includes('β'), 'Greek symbols must remain unescaped');
console.log('[PASS]: Emoji and surrogate pairs preserved in literal UTF-8.');

// 4. Lone Surrogates Rejection
console.log('--- 4. Lone Surrogates Rejection ---');
assert.throws(() => {
  CanonicalJson.stringify({ bad: '\uD800' });
}, TypeError, 'Must reject lone high surrogate');

assert.throws(() => {
  CanonicalJson.stringify({ bad: '\uDC00' });
}, TypeError, 'Must reject lone low surrogate');
console.log('[PASS]: Lone surrogates strictly rejected with TypeError.');

// 5. Number Edge Cases (RFC 8785 Section 3.2.2.3)
console.log('--- 5. Number Edge Cases ---');
// Negative zero must become 0
assert.strictEqual(CanonicalJson.stringify({ zero: -0 }), '{"zero":0}');
assert.strictEqual(CanonicalJson.stringify({ zero: 0 }), '{"zero":0}');

// Floating point representation
const floatObj = {
  int: 42,
  float: 3.14159,
  sciLarge: 1e21,
  sciSmall: 1e-7,
  regularSmall: 0.00001,
};
const floatCanonical = CanonicalJson.stringify(floatObj);
assert.ok(floatCanonical.includes('"int":42'));
assert.ok(floatCanonical.includes('"float":3.14159'));
assert.strictEqual(CanonicalJson.stringify(-0), '0');
assert.strictEqual(CanonicalJson.stringify(1e21), '1e+21');
assert.strictEqual(CanonicalJson.stringify(1e-7), '1e-7');
assert.strictEqual(CanonicalJson.stringify(0.00001), '0.00001');

// NaN and Infinity must throw TypeError
assert.throws(() => CanonicalJson.stringify(NaN), TypeError);
assert.throws(() => CanonicalJson.stringify(Infinity), TypeError);
assert.throws(() => CanonicalJson.stringify(-Infinity), TypeError);
console.log('[PASS]: Floating point and edge-case numbers comply with RFC 8785.');

// 6. Escaping Rules (Control Characters)
console.log('--- 6. Escaping Rules ---');
const escapeObj = {
  str: 'tab:\t newline:\n return:\r backspace:\b formfeed:\f quote:" backslash:\\',
  nullChar: 'null:\u0000 ctrl:\u001F',
};
const escapeCanonical = CanonicalJson.stringify(escapeObj);
assert.ok(escapeCanonical.includes('\\t'));
assert.ok(escapeCanonical.includes('\\n'));
assert.ok(escapeCanonical.includes('\\r'));
assert.ok(escapeCanonical.includes('\\b'));
assert.ok(escapeCanonical.includes('\\f'));
assert.ok(escapeCanonical.includes('\\"'));
assert.ok(escapeCanonical.includes('\\\\'));
assert.ok(escapeCanonical.includes('\\u0000'));
assert.ok(escapeCanonical.includes('\\u001f'));
console.log('[PASS]: Control characters escaped with RFC 8785 lowercase hex and standard escapes.');

// 7. Nested Objects and Arrays
console.log('--- 7. Nested Objects & Arrays Preserving Order ---');
const complexObj = {
  b: [
    { z: 1, a: 2 },
    { y: 3, x: 4 },
  ],
  a: {
    nestedB: false,
    nestedA: true,
  },
};
const complexCanonical = CanonicalJson.stringify(complexObj);
const expectedComplex = '{"a":{"nestedA":true,"nestedB":false},"b":[{"a":2,"z":1},{"x":4,"y":3}]}';
assert.strictEqual(complexCanonical, expectedComplex);
console.log('[PASS]: Nested structures and array orders strictly preserved.');

// 8. Digest Determinism across Permutations
console.log('--- 8. Digest Determinism ---');
const p1 = { a: 1, b: 2, c: { d: 3, e: [1, 2, 3] } };
const p2 = { c: { e: [1, 2, 3], d: 3 }, b: 2, a: 1 };
assert.strictEqual(CanonicalJson.digestSha256(p1), CanonicalJson.digestSha256(p2));
console.log(`[PASS]: Bit-exact SHA-256 digest: ${CanonicalJson.digestSha256(p1)}`);

console.log('\n[SUCCESS]: ALL 8 RFC 8785 TEST VECTOR GROUPS PASSED!');
