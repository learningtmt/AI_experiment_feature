'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runChecker, closeBrowser } = require('../server/checker');
const { MOCK_HTML } = require('../server/mock-html');

const mutate = (from, to) => {
  assert.ok(MOCK_HTML.includes(from), 'sample anchor missing: ' + from);
  return MOCK_HTML.replace(from, to);
};

const SAMPLES = {
  clean: MOCK_HTML,
  // Throws before gameReady: pageerror (H2), gameReady never true (H3).
  jsError: mutate('init();\nwindow.gameReady = true;', "throw new Error('boom');\ninit();\nwindow.gameReady = true;"),
  english: mutate('<button id="resetBtn" type="button">Làm lại</button>', '<button id="resetBtn" type="button">Làm lại</button><button id="resetEn" type="button">Reset</button>'),
  // The tall block sits outside the 100vh flex container, so the page really scrolls.
  scroll: mutate('overflow: hidden;', '').replace('<div id="tube"></div>\n</div>', '<div id="tube"></div>\n</div><div style="height:3000px"></div>'),
  network: mutate('<div id="tube"></div>', '<div id="tube"></div><img src="https://example.com/x.png" alt="ảnh">'),
  storage: mutate('var state = {', "localStorage.setItem('a', 'b'); var state = {"),
  noReset: mutate('Làm lại', 'Khôi phục'),
  inlineHandler: mutate('<button id="startBtn" type="button">', '<button id="startBtn" type="button" onclick="void 0">'),
  deadButton: mutate('<button id="resetBtn" type="button">Làm lại</button>', '<button id="resetBtn" type="button">Làm lại</button><button id="deadBtn" type="button">Nút thử</button>'),
  smallText: mutate('</style>', '.tiny { font-size: 10px; } </style>').replace('<h1>Thí nghiệm thử</h1>', '<h1>Thí nghiệm thử</h1><p class="tiny">chữ nhỏ</p>'),
};

const results = {};

test.before(async () => {
  const names = Object.keys(SAMPLES);
  const out = await Promise.all(names.map((n) => runChecker(SAMPLES[n])));
  names.forEach((n, i) => { results[n] = out[i]; });
});
test.after(async () => { await closeBrowser(); });

const failedIds = (r) => r.hardFailures.map((f) => f.id);
const warnedIds = (r) => r.softWarnings.map((w) => w.id);

test('checker: clean sample passes every hard check and has no warnings', () => {
  const r = results.clean;
  assert.deepEqual(r.hardFailures, []);
  assert.deepEqual(r.softWarnings, []);
  assert.equal(r.passed, true);
  assert.ok(r.trial.steps > 5, 'interaction trial should have run');
});

test('checker: JavaScript error is caught (H2, H3)', () => {
  assert.ok(failedIds(results.jsError).includes('H2'), failedIds(results.jsError).join(','));
  assert.ok(failedIds(results.jsError).includes('H3'));
  assert.equal(results.jsError.passed, false);
});

test('checker: English UI word is caught (H6) and named', () => {
  const r = results.english;
  assert.ok(failedIds(r).includes('H6'));
  assert.match(r.hardFailures.find((f) => f.id === 'H6').message, /reset/i);
  assert.ok(!failedIds(r).includes('H2'));
});

test('checker: page that scrolls is caught (H4) at both viewport sizes', () => {
  const r = results.scroll;
  assert.ok(failedIds(r).includes('H4'));
  const msg = r.hardFailures.find((f) => f.id === 'H4').message;
  assert.match(msg, /1366×768/);
  assert.match(msg, /1920×1080/);
});

test('checker: external network request is blocked and reported (H5)', () => {
  const r = results.network;
  assert.ok(failedIds(r).includes('H5'));
  assert.match(r.hardFailures.find((f) => f.id === 'H5').message, /example\.com/);
});

test('checker: localStorage in the source is caught (H9)', () => {
  assert.ok(failedIds(results.storage).includes('H9'));
});

test('checker: missing "Làm lại" button is caught (H8)', () => {
  assert.ok(failedIds(results.noReset).includes('H8'));
});

test('checker: soft warnings S2 (inline handler), S3 (small font), S4 (dead button)', () => {
  assert.ok(warnedIds(results.inlineHandler).includes('S2'));
  assert.ok(warnedIds(results.smallText).includes('S3'));
  const dead = results.deadButton;
  assert.ok(warnedIds(dead).includes('S4'));
  assert.match(dead.softWarnings.find((w) => w.id === 'S4').message, /Nút thử/);
  assert.ok(!dead.softWarnings.find((w) => w.id === 'S4').message.includes('Làm lại'), 'reset button changes state, not dead');
  assert.equal(dead.passed, true, 'soft warnings never fail the check');
});

test('checker: structure errors from the source are reported as H1', async () => {
  const r = await runChecker('<html><body><button>Làm lại</button></body></html>');
  assert.ok(failedIds(r).includes('H1'));
  assert.ok(failedIds(r).includes('H3'));
});
