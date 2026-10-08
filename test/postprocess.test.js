'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanHtml, cleanDescription, detectNotSuitable, checkStructure } = require('../server/postprocess');

const GOOD = '<!DOCTYPE html><html><body><script>init();\nwindow.gameReady = true;</script></body></html>';

test('postprocess: strips ``` fences around HTML', () => {
  const r = cleanHtml('```html\n' + GOOD + '\n```');
  assert.equal(r.kind, 'html');
  assert.equal(r.html, GOOD);
  assert.deepEqual(r.structureErrors, []);
});

test('postprocess: cuts text before <!DOCTYPE and after </html>', () => {
  const r = cleanHtml('Đây là mã HTML của bạn:\n\n' + GOOD + '\n\nChúc thầy cô dạy tốt!');
  assert.equal(r.html, GOOD);
});

test('postprocess: fence + chatter together', () => {
  const r = cleanHtml('Chắc chắn rồi!\n```html\n' + GOOD + '\n```\nHy vọng hữu ích.');
  assert.equal(r.html, GOOD);
});

test('postprocess: recognizes KHONG_PHU_HOP: including whitespace and wrapper characters', () => {
  for (const raw of [
    'KHONG_PHU_HOP: Bài này không có thí nghiệm.',
    '  \n KHONG_PHU_HOP:   Bài này không có thí nghiệm.  ',
    '`KHONG_PHU_HOP: Bài này không có thí nghiệm.`',
    '```\nKHONG_PHU_HOP: Bài này không có thí nghiệm.\n```',
    '**KHONG_PHU_HOP: Bài này không có thí nghiệm.**',
    '"KHONG_PHU_HOP : Bài này không có thí nghiệm."',
  ]) {
    const html = cleanHtml(raw);
    assert.equal(html.kind, 'not_suitable', raw);
    assert.equal(html.reason, 'Bài này không có thí nghiệm.', raw);
    const desc = cleanDescription(raw);
    assert.equal(desc.kind, 'not_suitable', raw);
    assert.equal(desc.reason, 'Bài này không có thí nghiệm.', raw);
  }
});

test('postprocess: KHONG_PHU_HOP in the middle of text is not a refusal', () => {
  assert.equal(detectNotSuitable('Tên thí nghiệm: ... KHONG_PHU_HOP: x'), null);
});

test('postprocess: detects a missing </html>', () => {
  const r = cleanHtml('<!DOCTYPE html><html><body><script>window.gameReady = true;</script></body>');
  assert.equal(r.kind, 'html');
  assert.ok(r.structureErrors.some((e) => e.includes('</html>')), r.structureErrors.join(';'));
});

test('postprocess: detects a missing DOCTYPE and missing gameReady', () => {
  const errors = checkStructure('<html><body></body></html>');
  assert.ok(errors.some((e) => e.includes('DOCTYPE')));
  assert.ok(errors.some((e) => e.includes('gameReady')));
  assert.deepEqual(checkStructure(GOOD), []);
});

test('postprocess: description is only de-fenced and trimmed of blank edge lines', () => {
  const body = 'Tên thí nghiệm: A\n\nMục tiêu kiến thức: B\n   thụt lề giữ nguyên';
  const r = cleanDescription('\n\n```\n' + body + '\n```\n\n');
  assert.equal(r.kind, 'description');
  assert.equal(r.text, body);
});

test('postprocess: description warnings for LaTeX and markdown, content unchanged', () => {
  const body = 'Tên thí nghiệm: $H_2O$\n**đậm**\n# tiêu đề\nđường dẫn C:\\x';
  const r = cleanDescription(body);
  assert.equal(r.text, body);
  assert.equal(r.warnings.length, 4);
  assert.deepEqual(cleanDescription('Tên thí nghiệm: H₂O').warnings, []);
});
