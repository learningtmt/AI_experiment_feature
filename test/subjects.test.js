'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedSubject, stripPrefix, filterSubjects } = require('../server/subjects');
const { getProvider } = require('../server/data-provider');

test('subjects: matches Vật lý and Vật lí, with the prefix removed case-insensitively', () => {
  assert.ok(isAllowedSubject('Sách điện tử môn Vật lý'));
  assert.ok(isAllowedSubject('Sách điện tử môn Vật lí'));
  assert.ok(isAllowedSubject('SÁCH ĐIỆN TỬ MÔN VẬT LÍ'));
  assert.ok(isAllowedSubject('sách điện tử môn hóa học'));
  assert.ok(isAllowedSubject('Sách điện tử môn Khoa học tự nhiên'));
  assert.ok(isAllowedSubject('Sách điện tử môn Sinh học'));
  assert.ok(isAllowedSubject('Sách điện tử môn Địa lí'));
  assert.ok(isAllowedSubject('Sách điện tử môn Địa lý'));
  assert.ok(isAllowedSubject('Sách điện tử môn   Hóa   học  '));
});

test('subjects: exact match only (no substring match)', () => {
  assert.equal(isAllowedSubject('Sách điện tử môn Lịch sử và Địa lí'), false);
  assert.equal(isAllowedSubject('Sách điện tử môn Toán'), false);
  assert.equal(isAllowedSubject('Sách điện tử môn Vật lí nâng cao'), false);
  assert.equal(isAllowedSubject('Sách điện tử môn Tin học'), false);
});

test('subjects: stripPrefix gives the display name', () => {
  assert.equal(stripPrefix('Sách điện tử môn Hóa học', 'Sách điện tử môn '), 'Hóa học');
  assert.equal(stripPrefix('sách điện tử môn Hóa học', 'Sách điện tử môn '), 'Hóa học');
  assert.equal(stripPrefix('Hóa học', 'Sách điện tử môn '), 'Hóa học');
});

test('subjects: fixtures list exactly the 5 whitelisted subjects and excludes the rest', async () => {
  const { shown, excluded } = filterSubjects(await getProvider('mock').getSubjects());
  assert.deepEqual(shown.map((s) => s.name), ['Sinh học', 'Vật lí', 'Hóa học', 'Khoa học tự nhiên', 'Địa lí']);
  assert.ok(shown.every((s) => /^SDT_/.test(s.id)));
  for (const n of ['Toán', 'Ngữ văn', 'Lịch sử', 'Tin học', 'Công nghệ', 'Lịch sử và Địa lí']) {
    assert.ok(excluded.includes('Sách điện tử môn ' + n), n + ' must be excluded');
  }
});
