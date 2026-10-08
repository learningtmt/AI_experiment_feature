'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fill, buildDescribePrompt, buildExperimentPrompt, TOKENS } = require('../server/prompts');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'prompts', f), 'utf8');

const V = { subject: 'Hóa học', class: 'Lớp 11', explain: 'Hydrocarbon không no > Alkene', note: 'YEUCAU' };

test('prompts: describe replaces its tokens', () => {
  const p = buildDescribePrompt({ ...V, current: 'MOTA_HIEN_TAI' });
  assert.match(p, /Môn học = Hóa học/);
  assert.match(p, /Khối lớp = Lớp 11/);
  assert.match(p, /Hydrocarbon không no > Alkene/);
  assert.match(p, /Mô tả hiện tại của giáo viên = MOTA_HIEN_TAI/);
  assert.match(p, /Yêu cầu thêm = YEUCAU/);
  for (const t of TOKENS.describe) assert.ok(!p.includes('{' + t + '}'), 'token {' + t + '} must be replaced');
});

test('prompts: experiment replaces its tokens for both variants', () => {
  for (const variant of ['vi', 'en']) {
    const p = buildExperimentPrompt({ ...V, experiment: 'THI_NGHIEM_X' }, variant);
    assert.match(p, /Mô tả thí nghiệm = THI_NGHIEM_X/);
    assert.match(p, /Yêu cầu thêm = YEUCAU/);
    assert.match(p, /Khối lớp = Lớp 11/);
    for (const t of TOKENS.experiment) assert.ok(!p.includes('{' + t + '}'), 'variant ' + variant + ': token {' + t + '} must be replaced');
  }
});

test('prompts: variant picks the right file', () => {
  const vi = buildExperimentPrompt({ ...V, experiment: 'x' }, 'vi');
  const en = buildExperimentPrompt({ ...V, experiment: 'x' }, 'en');
  assert.match(vi, /Bạn là AI Edtech Developer/);
  assert.match(en, /You are an AI Edtech developer/);
  assert.throws(() => buildExperimentPrompt({ ...V, experiment: 'x' }, 'fr'), /variant/);
});

test('prompts: empty / missing values become empty strings', () => {
  const p = buildDescribePrompt({ subject: 'S', class: 'C', explain: 'E' });
  assert.match(p, /Mô tả hiện tại của giáo viên = \n/);
  assert.match(p, /Yêu cầu thêm = \n/);
  assert.ok(!p.includes('undefined') && !p.includes('null'));
});

test('prompts: code and braces inside the prompt are untouched', () => {
  const tpl = read('thi_nghiem_html_v1.txt');
  const p = buildExperimentPrompt({ ...V, experiment: 'x' }, 'vi');
  // The verbatim safety script contains {} blocks and must survive byte for byte.
  const script = tpl.slice(tpl.indexOf('<script>'), tpl.indexOf('</script>') + '</script>'.length);
  assert.ok(script.includes('function showGameError() {'));
  assert.ok(p.includes(script));
  assert.ok(p.includes('${ ... }'), '"${ ... }" in the instructions is real content');
  assert.ok(p.includes('{…}'), '"{…}" is real content');
  // Everything outside the replaced tokens is identical to the template.
  const stripped = (s) => s.replace(/Môn học = .*|Khối lớp = .*|Vị trí bài học.*|Mô tả thí nghiệm = .*|Yêu cầu thêm = .*/g, '').replace(/\{class\}/g, '').replace(/Lớp 11/g, '');
  assert.equal(stripped(p), stripped(tpl));
});

test('prompts: fill is a single pass; values are inserted literally', () => {
  const out = fill('a {x} b {y} c ${z} {} {…}', ['x', 'y'], { x: 'X$&$$$1{y}', y: 'Y' });
  assert.equal(out, 'a X$&$$$1{y} b Y c ${z} {} {…}');
});

test('prompts: tokens of the other prompt are not replaced', () => {
  // {current} is a prompt-1 token only; prompt 2 must leave a literal {current} alone.
  assert.equal(fill('{current} {experiment}', TOKENS.experiment, { current: 'NO', experiment: 'YES' }), '{current} YES');
});

test('prompts: template is re-read on every call (no cache)', () => {
  // Uses a temp copy through PROMPTS_DIR; the real prompt files are never written.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'));
  const file = path.join(dir, 'mo_ta_thi_nghiem_v1.txt');
  const previous = process.env.PROMPTS_DIR;
  try {
    process.env.PROMPTS_DIR = dir;
    fs.writeFileSync(file, 'MOI {subject}');
    assert.equal(buildDescribePrompt({ subject: 'Lí' }), 'MOI Lí');
    fs.writeFileSync(file, 'SUA {subject}');
    assert.equal(buildDescribePrompt({ subject: 'Lí' }), 'SUA Lí');
  } finally {
    if (previous === undefined) delete process.env.PROMPTS_DIR; else process.env.PROMPTS_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(buildDescribePrompt({ subject: 'Lí' }).startsWith('Bạn là chuyên gia'));
});
