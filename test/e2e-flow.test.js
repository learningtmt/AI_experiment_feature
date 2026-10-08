'use strict';
// End-to-end flow test (T1 in tests/test_cases.md). LLM_MOCK=1, checker enabled.
// Drives the UI by element id and confirms data flow from the newest runs/.../prompt.txt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const A_TEXT = 'Cho 5 g kẽm viên vào 50 mL HCl 2M';

let server;
let serverLog = '';
let base;
let runsDir;
let browser;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

test.before(async () => {
  runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-e2e-'));
  const port = await freePort();
  base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, LLM_MOCK: '1', ENABLE_CHECKER: 'true', PORT: String(port), RUNS_DIR: runsDir, EXPERIMENT_PROMPT_VARIANT: 'vi', DATA_PROVIDER: 'mock' },
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start:\n' + serverLog)), 20000);
    const iv = setInterval(() => { if (serverLog.includes('Ứng dụng chạy tại')) { clearTimeout(t); clearInterval(iv); resolve(); } }, 50);
    server.on('exit', () => { clearTimeout(t); clearInterval(iv); reject(new Error('server exited early:\n' + serverLog)); });
  });
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  if (runsDir) fs.rmSync(runsDir, { recursive: true, force: true });
});

// ---- helpers --------------------------------------------------------------------------------------
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => { throw e; });
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#subject option').length > 1);
  return page;
}

async function pickLesson(page, { subject = 'Hóa học', cls = 'Lớp 10', lessonIndex = 1 } = {}) {
  await page.selectOption('#subject', { label: subject });
  await page.waitForFunction(() => !document.querySelector('#class').disabled);
  await page.selectOption('#class', { label: cls });
  await page.waitForFunction(() => !document.querySelector('#lesson').disabled && document.querySelectorAll('#lesson option').length > 1);
  await page.selectOption('#lesson', { index: lessonIndex });
}

function latestRun(kind) {
  const dirs = fs.readdirSync(runsDir).filter((d) => d.includes('_' + kind + '_')).sort();
  assert.ok(dirs.length, 'no ' + kind + ' run found');
  return path.join(runsDir, dirs[dirs.length - 1]);
}
const latestPrompt = (kind) => fs.readFileSync(path.join(latestRun(kind), 'prompt.txt'), 'utf8');

// {current} of prompt 1 / {experiment} of prompt 2, cut out of the assembled prompt.
function currentOf(prompt) {
  const start = prompt.lastIndexOf('Mô tả hiện tại của giáo viên = ') + 'Mô tả hiện tại của giáo viên = '.length;
  return prompt.slice(start, prompt.indexOf('\nYêu cầu thêm = ', start));
}
function experimentOf(prompt) {
  const marker = '\nMô tả thí nghiệm = ';
  const start = prompt.lastIndexOf(marker) + marker.length;
  return prompt.slice(start, prompt.indexOf('\n\nYêu cầu thêm = ', start));
}

const brainHidden = (page) => page.waitForFunction(() => document.getElementById('brain-overlay').hidden, null, { timeout: 60000 });

async function runAi(page) {
  await page.click('#ai-button');
  await brainHidden(page);
}
async function goContinue(page) {
  await page.click('#continue');
  await page.waitForFunction(() => !document.getElementById('screen-result').hidden, null, { timeout: 90000 });
}
const value = (page, sel) => page.inputValue(sel);
const visible = (page, sel) => page.locator(sel).isVisible();

// ---- 1 + 2 + 3 + 4: AI from box A, then Continue uses B / edited B / A ---------------------------------
test('T1 1-4: AI uses box A, brain blocks input, Continue uses box B, edited B, then A after clearing B', { timeout: 240000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', A_TEXT);
  assert.equal(await page.textContent('#ai-button'), 'AI hoàn thiện mô tả');
  assert.equal(await visible(page, '#ai-description'), false, 'box B is hidden before the first AI run');

  // Slow the request so the brain screen can be inspected.
  await page.route('**/api/describe', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await page.click('#ai-button');
  assert.equal(await visible(page, '#brain-overlay'), true, 'brain screen visible');
  assert.equal(await page.$eval('#app', (el) => el.inert), true, 'page behind is inert');
  // Try to type and click while it is shown: nothing may change.
  const boxA = await page.locator('#teacher-description').boundingBox();
  await page.mouse.click(boxA.x + 20, boxA.y + 20);
  await page.keyboard.type('ZZZ');
  const cont = await page.locator('#continue').boundingBox();
  await page.mouse.click(cont.x + 5, cont.y + 5);
  const subj = await page.locator('#subject').boundingBox();
  await page.mouse.click(subj.x + 5, subj.y + 5);
  assert.equal(await value(page, '#teacher-description'), A_TEXT, 'box A unchanged while brain is shown');
  assert.equal(await visible(page, '#screen-result'), false, 'Continue did nothing while brain is shown');
  await brainHidden(page);
  await page.unroute('**/api/describe');

  // 1. prompt 1 got box A; box B appeared; box A untouched.
  assert.equal(currentOf(latestPrompt('describe')), A_TEXT);
  assert.equal(await visible(page, '#ai-description'), true);
  const b = await value(page, '#ai-description');
  assert.ok(b.trim().length > 20, 'box B has content');
  assert.equal(await value(page, '#teacher-description'), A_TEXT, 'box A unchanged character by character');

  // 2. Continue -> {experiment} is exactly box B.
  await goContinue(page);
  assert.equal(experimentOf(latestPrompt('experiment')), b);
  assert.equal(await value(page, '#effective-description'), b);
  assert.equal(await page.locator('#preview-frame').count(), 1);
  assert.equal(await page.getAttribute('#preview-frame', 'sandbox'), 'allow-scripts');
  assert.ok((await page.getAttribute('#preview-frame', 'srcdoc')).includes('window.gameReady = true'));

  // 3. Edit box B (append XYZ), Continue.
  await page.click('#back-to-edit');
  assert.equal(await value(page, '#ai-description'), b, 'back-to-edit keeps box B');
  await page.fill('#ai-description', b + 'XYZ');
  await goContinue(page);
  assert.equal(experimentOf(latestPrompt('experiment')), b + 'XYZ');
  assert.ok(latestPrompt('experiment').includes('XYZ'));

  // 4. Clear box B, Continue -> box A.
  await page.click('#back-to-edit');
  await page.click('#ai-clear');
  assert.equal(await value(page, '#ai-description'), '');
  await goContinue(page);
  assert.equal(experimentOf(latestPrompt('experiment')), A_TEXT);
  await page.context().close();
});

// ---- 5: only box A, no AI -----------------------------------------------------------------------------
test('T1 5: only box A, no AI -> prompt 2 uses box A', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', A_TEXT);
  await goContinue(page);
  assert.equal(experimentOf(latestPrompt('experiment')), A_TEXT);
  assert.equal(await value(page, '#effective-description'), A_TEXT);
  await page.context().close();
});

// ---- 6 + 10: prompt 1 always reads box A; undo; clear -----------------------------------------------------
test('T1 6 + 10: prompt 1 always reads box A, box B is overwritten, undo restores, clear empties', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', A_TEXT);
  await runAi(page);
  const first = await value(page, '#ai-description');
  assert.equal(await visible(page, '#ai-undo'), false, 'nothing to undo after the first run');

  await page.fill('#ai-description', first + ' XYZ');
  const edited = await value(page, '#ai-description');
  await runAi(page);
  const p2 = latestPrompt('describe');
  assert.equal(currentOf(p2), A_TEXT, '{current} is box A, not box B');
  assert.ok(!currentOf(p2).includes('XYZ'));
  assert.ok(!(await value(page, '#ai-description')).includes('XYZ'), 'box B overwritten with the new result');

  assert.equal(await visible(page, '#ai-undo'), true);
  await page.click('#ai-undo');
  assert.equal(await value(page, '#ai-description'), edited, 'undo restores the version with XYZ');
  assert.equal(await visible(page, '#ai-undo'), false, 'undo is used up');

  await runAi(page);
  assert.equal(currentOf(latestPrompt('describe')), A_TEXT, 'third run still reads box A');

  await page.click('#ai-clear');
  assert.equal(await value(page, '#ai-description'), '');
  assert.equal(await value(page, '#teacher-description'), A_TEXT);
  await page.context().close();
});

// ---- 7: empty box A -----------------------------------------------------------------------------------------
test('T1 7: empty box A -> create mode, {current} stays empty, Continue enabled', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  assert.equal(await page.textContent('#ai-button'), 'AI tạo mô tả');
  await runAi(page);
  assert.equal(currentOf(latestPrompt('describe')), '');
  assert.ok((await value(page, '#ai-description')).trim().length > 20);
  assert.equal(await page.isDisabled('#continue'), false, 'Continue enabled although box A is empty');
  assert.equal(await page.textContent('#ai-button'), 'AI tạo mô tả', 'label depends on box A only');
  await runAi(page);
  assert.equal(currentOf(latestPrompt('describe')), '', 'second run still does not read box B');
  await page.context().close();
});

// ---- 8: at-least-one-of-two rule and button states ------------------------------------------------------------
test('T1 8: at least one of the two boxes; button states follow Môn/Lớp/Bài', { timeout: 120000 }, async () => {
  const page = await newPage();
  const hint = '#description-hint';
  // Nothing selected yet: both buttons disabled even with a description.
  await page.fill('#teacher-description', A_TEXT);
  assert.equal(await page.isDisabled('#continue'), true);
  assert.equal(await page.isDisabled('#ai-button'), true);
  await page.fill('#teacher-description', '');
  await pickLesson(page);
  assert.equal(await page.isDisabled('#ai-button'), false, 'AI button depends only on Môn/Lớp/Bài');

  // (A empty, B empty)
  assert.equal(await page.isDisabled('#continue'), true);
  assert.equal(await visible(page, hint), true);
  // Make box B appear through the AI, then play with both boxes.
  await runAi(page);
  const setBoth = async (a, b) => { await page.fill('#teacher-description', a); await page.fill('#ai-description', b); };

  await setBoth('', '');
  assert.equal(await page.isDisabled('#continue'), true);
  assert.equal(await visible(page, hint), true);
  await setBoth(A_TEXT, '');
  assert.equal(await page.isDisabled('#continue'), false);
  assert.equal(await visible(page, hint), false);
  await setBoth('', 'mô tả AI');
  assert.equal(await page.isDisabled('#continue'), false);
  assert.equal(await page.textContent('#ai-button'), 'AI tạo mô tả', 'A empty + B filled is still "AI tạo mô tả"');
  await setBoth(A_TEXT, 'mô tả AI');
  assert.equal(await page.isDisabled('#continue'), false);
  assert.equal(await page.textContent('#ai-button'), 'AI hoàn thiện mô tả');
  await setBoth('   \n ', ' \t  ');
  assert.equal(await page.isDisabled('#continue'), true, 'whitespace only counts as empty');
  assert.equal(await visible(page, hint), true);
  assert.equal(await page.textContent('#ai-button'), 'AI tạo mô tả');

  // Clearing the lesson disables both again although a description exists.
  await setBoth(A_TEXT, 'mô tả AI');
  await page.selectOption('#lesson', { index: 0 });
  assert.equal(await page.isDisabled('#continue'), true);
  assert.equal(await page.isDisabled('#ai-button'), true);
  await page.context().close();
});

// ---- 9: stale warning ------------------------------------------------------------------------------------------
test('T1 9: stale warning for box B', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', A_TEXT);
  await runAi(page);
  const warn = '#ai-stale-warning';
  assert.equal(await visible(page, warn), false);

  await page.fill('#teacher-description', A_TEXT + ' thêm');
  assert.equal(await visible(page, warn), true, 'A changed after AI -> warning');
  assert.match(await page.textContent(warn), /Mô tả của thầy cô đã thay đổi sau khi AI tạo/);
  await runAi(page);
  assert.equal(await visible(page, warn), false, 'running the AI again clears it');

  await page.fill('#teacher-description', A_TEXT);
  assert.equal(await visible(page, warn), true);
  await page.click('#ai-clear');
  assert.equal(await visible(page, warn), false, 'clearing box B clears it');

  await page.fill('#teacher-description', A_TEXT + ' nữa');
  assert.equal(await visible(page, warn), false, 'A edited while B is empty -> no warning');
  await page.context().close();
});

// ---- 11: not suitable ---------------------------------------------------------------------------------------------
test('T1 11: KHONG_PHU_HOP_TEST -> orange message, boxes unchanged; same at Continue', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', 'KHONG_PHU_HOP_TEST');
  await runAi(page);
  const msg = page.locator('#ai-message');
  assert.equal(await msg.isVisible(), true);
  assert.match(await msg.textContent(), /không có thí nghiệm mô phỏng được/);
  assert.equal(await msg.evaluate((n) => n.classList.contains('warn')), true);
  assert.equal(await msg.evaluate((n) => getComputedStyle(n).borderTopColor), 'rgb(251, 140, 0)', 'orange border');
  assert.equal(await value(page, '#teacher-description'), 'KHONG_PHU_HOP_TEST');
  assert.equal(await visible(page, '#ai-description'), false, 'box B stays hidden and empty');
  assert.equal(await value(page, '#ai-description'), '');

  await goContinue(page);
  const em = page.locator('#experiment-message');
  assert.equal(await em.isVisible(), true);
  assert.equal(await em.evaluate((n) => n.classList.contains('warn')), true);
  assert.equal(await page.locator('#preview-frame').count(), 0, 'no preview frame');
  assert.equal(await page.isDisabled('#download'), true);
  await page.context().close();
});

// ---- 12: back-to-edit, whitelist, reloading on subject change --------------------------------------------------------
test('T1 12 + k: back-to-edit keeps everything; 5 whitelisted subjects; subject change reloads class and lessons', { timeout: 120000 }, async () => {
  const page = await newPage();
  const subjects = await page.$$eval('#subject option', (os) => os.map((o) => o.textContent));
  assert.deepEqual(subjects, ['Chọn môn học', 'Sinh học', 'Vật lí', 'Hóa học', 'Khoa học tự nhiên', 'Địa lí']);
  assert.deepEqual(await page.$$eval('#subject option', (os) => os.slice(1).map((o) => /^SDT_/.test(o.value))), [true, true, true, true, true]);

  await pickLesson(page, { subject: 'Hóa học', cls: 'Lớp 10', lessonIndex: 2 });
  const lessonValue = await value(page, '#lesson');
  const groups = await page.$$eval('#lesson optgroup', (gs) => gs.map((g) => g.label));
  assert.ok(groups.length >= 2 && groups.includes('Tốc độ phản ứng hóa học'), 'optgroups by chapter: ' + groups.join('|'));
  await page.fill('#teacher-description', A_TEXT);
  await page.click('#extra-toggle');
  await page.fill('#extra-note', 'Yêu cầu thêm X');
  await runAi(page);
  const b = await value(page, '#ai-description');
  await goContinue(page);
  assert.match(await page.textContent('#result-title'), /Hóa học/);
  await page.click('#back-to-edit');
  assert.equal(await value(page, '#subject'), await page.$eval('#subject', (s) => [...s.options].find((o) => o.textContent === 'Hóa học').value));
  assert.equal(await page.$eval('#class', (s) => s.options[s.selectedIndex].textContent), 'Lớp 10');
  assert.equal(await value(page, '#lesson'), lessonValue);
  assert.equal(await value(page, '#teacher-description'), A_TEXT);
  assert.equal(await value(page, '#ai-description'), b);
  assert.equal(await value(page, '#extra-note'), 'Yêu cầu thêm X');
  assert.ok(latestPrompt('experiment').includes('Yêu cầu thêm = Yêu cầu thêm X'), 'note reaches the prompt');

  // Change subject: lessons reload, lesson choice cleared, both descriptions kept.
  await page.selectOption('#subject', { label: 'Vật lí' });
  await page.waitForFunction(() => document.querySelector('#lesson').value === '' && !document.querySelector('#lesson').disabled && document.querySelector('#lesson optgroup[label="Mở đầu"]'));
  assert.equal(await value(page, '#lesson'), '');
  assert.equal(await value(page, '#teacher-description'), A_TEXT);
  assert.equal(await value(page, '#ai-description'), b);
  assert.equal(await page.isDisabled('#continue'), true, 'lesson cleared -> Continue disabled');

  // Empty lesson data: Khoa học tự nhiên, Lớp 6.
  await page.selectOption('#subject', { label: 'Khoa học tự nhiên' });
  await page.waitForFunction(() => document.querySelectorAll('#class option').length === 5);
  assert.deepEqual(await page.$$eval('#class option', (os) => os.slice(1).map((o) => o.textContent)), ['Lớp 6', 'Lớp 7', 'Lớp 8', 'Lớp 9']);
  await page.selectOption('#class', { label: 'Lớp 6' });
  await page.waitForFunction(() => document.querySelector('#lesson option').textContent.includes('Chưa có dữ liệu'));
  assert.equal(await page.isDisabled('#lesson'), true);
  assert.equal(await page.$eval('#lesson option', (o) => o.textContent), 'Chưa có dữ liệu bài học cho lớp này');
  await page.context().close();
});

// ---- result screen: download, fullscreen, regenerate, dev panel -----------------------------------------------------------
test('result screen: download name, fullscreen blob, regenerate, dev panel', { timeout: 180000 }, async () => {
  const page = await newPage();
  await pickLesson(page, { subject: 'Hóa học', cls: 'Lớp 10', lessonIndex: 1 });
  await page.fill('#teacher-description', A_TEXT);
  await goContinue(page);

  const lessonName = await page.$eval('#lesson', (s) => s.options[s.selectedIndex].textContent);
  const slug = lessonName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  assert.equal(download.suggestedFilename(), 'thi-nghiem-' + slug + '.html');
  const downloaded = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(downloaded.startsWith('<!DOCTYPE html>'));

  const [popup] = await Promise.all([page.context().waitForEvent('page'), page.click('#fullscreen')]);
  await popup.waitForLoadState();
  assert.ok(popup.url().startsWith('blob:'), 'fullscreen opens a blob URL');
  assert.equal(await popup.title(), 'Thí nghiệm thử');
  await popup.close();

  // Dev panel shows the attempt, the checks and the run folder.
  const dev = page.locator('#dev-panel');
  assert.equal(await dev.evaluate((d) => d.open), true, 'dev panel open by default');
  const text = await dev.textContent();
  assert.match(text, /Lần thử 1/);
  assert.match(text, /ĐẠT/);
  assert.match(text, /H6/);
  assert.match(text, /runs\/\d{4}-\d{2}-\d{2}T/);
  await dev.locator('button', { hasText: 'Xem prompt đã ghép' }).click();
  await page.waitForFunction(() => document.querySelector('#dev-panel pre:not([hidden])') && document.querySelector('#dev-panel pre:not([hidden])').textContent.includes('Mô tả thí nghiệm = '));

  // Regenerate calls prompt 2 again with the same input.
  const before = fs.readdirSync(runsDir).filter((d) => d.includes('_experiment_')).length;
  await page.click('#regenerate');
  await page.waitForFunction(() => document.getElementById('brain-overlay').hidden && !document.getElementById('screen-result').hidden);
  assert.equal(fs.readdirSync(runsDir).filter((d) => d.includes('_experiment_')).length, before + 1);
  assert.equal(experimentOf(latestPrompt('experiment')), A_TEXT);
  await page.context().close();
});

// ---- API error handling --------------------------------------------------------------------------------------------------
test('error from the server: message with retry button, data kept', { timeout: 120000 }, async () => {
  const page = await newPage();
  await pickLesson(page);
  await page.fill('#teacher-description', A_TEXT);
  await page.route('**/api/describe', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Lỗi thử nghiệm' }) }));
  await runAi(page);
  const msg = page.locator('#ai-message');
  assert.equal(await msg.isVisible(), true);
  assert.match(await msg.textContent(), /Lỗi thử nghiệm/);
  assert.equal(await page.locator('#ai-retry').isVisible(), true);
  assert.equal(await value(page, '#teacher-description'), A_TEXT);
  assert.equal(await visible(page, '#ai-description'), false);
  await page.unroute('**/api/describe');
  await page.click('#ai-retry');
  await brainHidden(page);
  assert.equal(await visible(page, '#ai-description'), true, 'retry works');
  assert.equal(await page.locator('#ai-message').isVisible(), false);
  await page.context().close();
});
