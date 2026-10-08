'use strict';
// Runs the eval runner end to end with the mock model on 2 cases and checks the artifacts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');

test('eval: mock run produces summary.json, report.md and gallery.html; inputs stay untouched', { timeout: 180000 }, () => {
  const watched = ['eval/cases.json', 'prompts/mo_ta_thi_nghiem_v1.txt', 'prompts/thi_nghiem_html_v1.txt', 'prompts/thi_nghiem_html_v1_en.txt', 'tests/test_cases.md'];
  const before = watched.map(sha);
  const r = spawnSync(process.execPath, ['eval/run-eval.js', '--variants', 'vi,en', '--limit', '4', '--only', 'T3-zn-hcl-hoan-thien,T4a-tu-choi-mo-ta'], {
    cwd: ROOT, env: { ...process.env, LLM_MOCK: '1', ENABLE_CHECKER: 'true' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(watched.map(sha), before, 'cases.json, prompts and test_cases.md must not change');
  const m = /Kết quả: (eval\/results\/\S+)/.exec(r.stdout);
  assert.ok(m, 'result folder is printed');
  const dir = path.join(ROOT, m[1]);
  try {
    for (const f of ['summary.json', 'report.md', 'gallery.html']) assert.ok(fs.existsSync(path.join(dir, f)), f);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    assert.equal(summary.cases.length, 2);
    const t3 = summary.cases.find((c) => c.id === 'T3-zn-hcl-hoan-thien');
    assert.deepEqual(Object.keys(t3.variants), ['vi', 'en']);
    assert.equal(t3.variants.vi.passedFirst, true);
    assert.ok(t3.variants.vi.outputHtml);
    const t4a = summary.cases.find((c) => c.id === 'T4a-tu-choi-mo-ta');
    assert.deepEqual(t4a.variants, {}, 'describe-only never runs prompt 2');
    const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8');
    assert.match(report, /Bảng case × variant/);
    assert.match(report, /Tỉ lệ đạt kiểm tra bắt buộc/);
    const gallery = fs.readFileSync(path.join(dir, 'gallery.html'), 'utf8');
    assert.match(gallery, /AC1 đúng hiện tượng/);
    assert.match(gallery, /AC2 đúng kiến thức/);
    assert.match(gallery, /sandbox="allow-scripts"/);
    assert.ok(!/https?:\/\//.test(gallery.replace(/<!DOCTYPE[^>]*>/, '')), 'gallery has no network references');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
