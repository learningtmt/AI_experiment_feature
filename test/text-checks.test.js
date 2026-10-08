'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findStoplistHits, findSuspectEnglish } = require('../server/text-checks');

const words = (text) => findStoplistHits(text).map((h) => h.word);

test('english: catches Reset, Start, Temperature', () => {
  assert.deepEqual(words('Reset'), ['reset']);
  assert.deepEqual(words('Start'), ['start']);
  assert.deepEqual(words('Temperature'), ['temperature']);
  assert.deepEqual(words('Nhấn Start để bắt đầu, Temperature = 25 °C').sort(), ['start', 'temperature']);
});

test('english: case-insensitive, whole word only', () => {
  assert.deepEqual(words('RESET'), ['reset']);
  assert.deepEqual(words('startup starting resetting'), []);   // not the whole token
  assert.deepEqual(words('Back, Show, Close, OK'), ['back', 'show', 'close', 'ok']);
});

test('english: does not flag formulas, symbols and units', () => {
  for (const s of ['H₂O', 'NaCl', 'mol', '°C', 'm/s', 'pH', 'CO₂', 'NaOH', 'HCl', 'NO', 'Pa', 'kg', 'mL', 'Hz', 'Ω', 'J', 'N']) {
    assert.deepEqual(words(s), [], s);
    assert.deepEqual(findSuspectEnglish(s), [], 'S1 ' + s);
  }
});

test('english: does not flag short toneless Vietnamese words', () => {
  assert.deepEqual(words('cho hai ba'), []);
  assert.deepEqual(findSuspectEnglish('cho hai ba'), []);
});

test('english: tokens with digits or subscript digits are skipped', () => {
  assert.deepEqual(words('Time2 Start₂'), []);
});

test('english S1: toneless Vietnamese words are not suspected, English-looking words are', () => {
  assert.deepEqual(findSuspectEnglish('nhanh thanh trong chinh khong nuoc'), []);
  const s = findSuspectEnglish('Chọn Mode: loop, play, text và Volume');
  for (const w of ['Mode', 'loop', 'play', 'text', 'Volume']) assert.ok(s.includes(w), w + ' should be suspected: ' + s.join(','));
});

test('english: Vietnamese text with diacritics is clean (NFC and NFD)', () => {
  const text = 'Làm lại · Bắt đầu · Nồng độ HCl · Kết quả';
  assert.deepEqual(words(text), []);
  assert.deepEqual(words(text.normalize('NFD')), []);
  assert.deepEqual(findSuspectEnglish(text.normalize('NFD')), []);
});
