'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hasDescription, effectiveDescription, aiInput } = require('../server/resolve');

// [A, B, hasDescription, effectiveDescription]
const CASES = [
  ['mô tả A', 'mô tả B', true, 'mô tả B'],          // A has / B has
  ['mô tả A', '', true, 'mô tả A'],                 // A has / B empty
  ['mô tả A', '   \n ', true, 'mô tả A'],           // A has / B whitespace only
  ['', 'mô tả B', true, 'mô tả B'],                 // A empty / B has
  ['  \t ', ' \n ', false, '  \t '],                // both whitespace only
  ['', '', false, ''],                              // both empty
];

for (const [a, b, has, eff] of CASES) {
  test('resolve: A=' + JSON.stringify(a) + ' B=' + JSON.stringify(b), () => {
    assert.equal(hasDescription(a, b), has);
    assert.equal(effectiveDescription(a, b), eff);
    assert.equal(aiInput(a), a, 'aiInput must return box A exactly');
    assert.notEqual(aiInput(a) === b && a !== b, true, 'aiInput must never return box B');
  });
}

test('resolve: effectiveDescription keeps box B untrimmed when it has content', () => {
  assert.equal(effectiveDescription('A', '  B \n'), '  B \n');
});

test('resolve: aiInput ignores box B whatever it contains', () => {
  assert.equal(aiInput('A'), 'A');
  assert.equal(aiInput(''), '');
});

test('resolve: handles null / undefined as empty', () => {
  assert.equal(hasDescription(null, undefined), false);
  assert.equal(hasDescription(undefined, 'x'), true);
});
