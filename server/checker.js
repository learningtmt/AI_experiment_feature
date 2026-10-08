'use strict';
// Automatic checks of a generated experiment page, using Playwright Chromium.
// Hard checks H1..H9 trigger a retry when they fail; soft checks S1..S5 are only reported.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { checkStructure } = require('./postprocess');
const { loadStoplist, findStoplistHits, findSuspectEnglish } = require('./text-checks');

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];
const READY_TIMEOUT_MS = 5000;
const LOAD_TIMEOUT_MS = 20000;
const MAX_STEPS_PER_PASS = 80;
const STEP_WAIT_MS = 150;
const TRIAL_BUDGET_MS = 90000;

const HARD_IDS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'];
const SOFT_IDS = ['S1', 'S2', 'S3', 'S4', 'S5'];

const HARD_TITLES = {
  H1: 'Cấu trúc HTML hợp lệ',
  H2: 'Không có lỗi JavaScript / console.error',
  H3: 'window.gameReady = true trong 5 giây, không có #gameErrorBox',
  H4: 'Không phải cuộn trang (1366×768 và 1920×1080)',
  H5: 'Không gọi mạng ra ngoài',
  H6: 'Không có từ tiếng Anh trong danh sách chặn',
  H7: 'Thử thao tác không phát sinh lỗi',
  H8: 'Có nút "Làm lại"',
  H9: 'Không dùng localStorage / sessionStorage / cookie',
};
const SOFT_TITLES = {
  S1: 'Nghi có tiếng Anh lọt vào',
  S2: 'Có thuộc tính onclick / oninput / onchange trong mã nguồn',
  S3: 'Cỡ chữ nhỏ nhất < 14px ở 1920px',
  S4: 'Nút nghi là nút chết (bấm không đổi DOM hay canvas)',
  S5: 'Chữ hiển thị chứa dấu hiệu LaTeX / markdown',
};

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { (await p).close(); } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- code that runs inside the page ------------------------------------------------------------
const PAGE = {
  installTools() {
    if (window.__chk) return;
    window.__chk = { ids: new WeakMap(), els: new Map(), n: 0, mut: 0 };
    new MutationObserver((m) => { window.__chk.mut += m.length; }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
  },

  mutationCount() {
    return window.__chk.mut;
  },

  canvasSignature() {
    let sig = '';
    for (const c of document.querySelectorAll('canvas')) {
      try {
        const t = document.createElement('canvas');
        t.width = 48; t.height = 27;
        t.getContext('2d').drawImage(c, 0, 0, 48, 27);
        sig += t.toDataURL() + '|';
      } catch (e) { sig += 'x|'; }
    }
    return sig;
  },

  // Visible, enabled interactive elements in DOM order, each with a stable id.
  listInteractive() {
    const sel = 'button, [role=button], select, input[type=range], input[type=checkbox], input[type=radio], input[type=button], input[type=submit]';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[inert]')) continue;
      let id = window.__chk.ids.get(el);
      if (id === undefined) { id = ++window.__chk.n; window.__chk.ids.set(el, id); window.__chk.els.set(id, el); }
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const label = ((el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '') + '').trim().replace(/\s+/g, ' ').slice(0, 40);
      out.push({ id, tag, type, label, options: tag === 'select' ? el.options.length : 0 });
    }
    return out;
  },

  setRange(id, which) {
    const el = window.__chk.els.get(id);
    const min = el.min === '' ? 0 : Number(el.min);
    const max = el.max === '' ? 100 : Number(el.max);
    const v = which === 'min' ? min : which === 'max' ? max : (min + max) / 2;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },

  setSelect(id, index) {
    const el = window.__chk.els.get(id);
    el.selectedIndex = index;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },

  // Everything a teacher or student can read.
  visibleTexts() {
    const out = [document.title];
    if (document.body) out.push(document.body.innerText);
    document.querySelectorAll('svg text').forEach((t) => out.push(t.textContent));
    document.querySelectorAll('[title],[aria-label],[placeholder],[alt]').forEach((el) => {
      ['title', 'aria-label', 'placeholder', 'alt'].forEach((a) => { const v = el.getAttribute(a); if (v) out.push(v); });
    });
    document.querySelectorAll('option').forEach((o) => out.push(o.textContent));
    return out.filter(Boolean);
  },

  hasResetButton() {
    const nodes = document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]');
    return [...nodes].some((n) => /làm lại/i.test((n.innerText || '') + ' ' + (n.value || '') + ' ' + (n.getAttribute('aria-label') || '')));
  },

  scrollInfo() {
    const de = document.documentElement;
    const b = document.body;
    return {
      scrollWidth: Math.max(de.scrollWidth, b ? b.scrollWidth : 0),
      scrollHeight: Math.max(de.scrollHeight, b ? b.scrollHeight : 0),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  },

  // Smallest computed font size of visible text (SVG text is scaled by its on-screen transform).
  minFontInfo() {
    let min = Infinity;
    let sample = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.trim();
      if (!text) continue;
      const el = node.parentElement;
      if (!el || el.closest('script, style, noscript, option')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let px = parseFloat(cs.fontSize);
      const svg = el.closest('svg');
      if (svg && typeof el.getScreenCTM === 'function') {
        const m = el.getScreenCTM();
        if (m) px *= Math.sqrt(m.a * m.a + m.b * m.b);
      }
      if (px < min) { min = px; sample = text.slice(0, 30); }
    }
    return { min: min === Infinity ? null : Math.round(min * 10) / 10, sample };
  },
};

// ---- helpers -----------------------------------------------------------------------------
function shot(page, runDir, phase, vp) {
  if (!runDir) return Promise.resolve(null);
  const file = path.join(runDir, 'screens', phase + '-' + vp.width + 'x' + vp.height + '.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return page.screenshot({ path: file }).then(() => file, () => null);
}

async function evalPage(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

async function clickById(page, id) {
  const handle = await page.evaluateHandle((i) => window.__chk.els.get(i), id);
  const el = handle.asElement();
  if (!el) throw new Error('phần tử không còn');
  try { await el.click({ timeout: 2000 }); } finally { await handle.dispose(); }
}

function actionsFor(item) {
  if (item.tag === 'select') return Array.from({ length: Math.min(item.options, 12) }, (_, i) => 'opt' + i);
  if (item.type === 'range') return ['min', 'max', 'mid'];
  return ['click'];
}

// One pass of the interaction trial. Re-lists the interactive elements before every step.
async function runPass(page, ctx, deadline) {
  const done = new Set();
  for (let step = 0; step < MAX_STEPS_PER_PASS; step++) {
    if (Date.now() > deadline) { ctx.truncated = true; return; }
    const items = await evalPage(page, PAGE.listInteractive);
    let target = null;
    for (const item of items) {
      const act = actionsFor(item).find((a) => !done.has(item.id + ':' + a));
      if (act) { target = { item, act }; break; }
    }
    if (!target) return;
    const { item, act } = target;
    done.add(item.id + ':' + act);

    const errorsBefore = ctx.errors.length;
    const isButton = item.tag !== 'select' && !['range', 'checkbox', 'radio'].includes(item.type);
    const mutBefore = isButton ? await evalPage(page, PAGE.mutationCount) : 0;
    const sigBefore = isButton ? await evalPage(page, PAGE.canvasSignature) : '';
    let clickFailed = null;
    try {
      if (act === 'click') await clickById(page, item.id);
      else if (act.startsWith('opt')) await evalPage(page, PAGE.setSelect, item.id, Number(act.slice(3)));
      else await evalPage(page, PAGE.setRange, item.id, act);
    } catch (e) {
      clickFailed = String(e.message || e).split('\n')[0].slice(0, 120);
    }
    await sleep(STEP_WAIT_MS);

    if (isButton) {
      const rec = ctx.buttons.get(item.id) || { label: item.label || '(không có chữ)', clicks: 0, changed: false, failures: 0, lastFailure: '' };
      if (clickFailed) { rec.failures++; rec.lastFailure = clickFailed; }
      else {
        rec.clicks++;
        const mutAfter = await evalPage(page, PAGE.mutationCount);
        const sigAfter = await evalPage(page, PAGE.canvasSignature);
        if (mutAfter > mutBefore || sigAfter !== sigBefore) rec.changed = true;
      }
      ctx.buttons.set(item.id, rec);
    }
    ctx.steps++;
    if (ctx.errors.length > errorsBefore) {
      const what = item.tag + (item.label ? ' "' + item.label + '"' : '') + ' → ' + act;
      for (const e of ctx.errors.slice(errorsBefore)) ctx.trialErrors.push(what + ': ' + e);
    }
  }
}

async function clickResetButton(page, ctx) {
  const items = await evalPage(page, PAGE.listInteractive);
  const reset = items.find((i) => /làm lại/i.test(i.label));
  if (!reset) return false;
  const before = ctx.errors.length;
  try { await clickById(page, reset.id); } catch { /* reported by H8/S4 elsewhere */ }
  await sleep(300);
  for (const e of ctx.errors.slice(before)) ctx.trialErrors.push('Làm lại: ' + e);
  return true;
}

async function runTrial(page, ctx) {
  const deadline = Date.now() + TRIAL_BUDGET_MS;
  await runPass(page, ctx, deadline);
  await runPass(page, ctx, deadline);
  await clickResetButton(page, ctx);
  await runPass(page, ctx, deadline);
}

// ---- main ----------------------------------------------------------------------------------
// runChecker(html, { runDir }) -> { passed, checks, hardFailures, softWarnings, soft, screenshots, ... }
async function runChecker(html, { runDir } = {}) {
  const started = Date.now();
  const stoplist = loadStoplist();
  const hard = {};
  const soft = {};
  HARD_IDS.forEach((id) => { hard[id] = { title: HARD_TITLES[id], pass: true, details: [] }; });
  SOFT_IDS.forEach((id) => { soft[id] = { title: SOFT_TITLES[id], count: 0, items: [] }; });
  const fail = (id, detail) => { hard[id].pass = false; if (detail) hard[id].details.push(detail); };
  const warn = (id, item) => { soft[id].count++; if (item) soft[id].items.push(item); };
  const screenshots = [];

  // Static checks on the source.
  for (const e of checkStructure(html)) fail('H1', e);
  if (/\blocalStorage\b|\bsessionStorage\b|document\s*\.\s*cookie/.test(html)) fail('H9', 'Mã nguồn dùng localStorage / sessionStorage / document.cookie');
  if (/\son(?:click|input|change)\s*=\s*["']/i.test(html)) warn('S2', 'Có thuộc tính on(click|input|change)= trong mã nguồn');

  const browser = await getBrowser();
  const allTexts = new Set();
  const blocked = new Set();
  const errorMessages = new Map(); // message -> viewport label (H2)
  let trialCtx = null;
  let hasReset = false;

  for (const vp of VIEWPORTS) {
    const label = vp.width + '×' + vp.height;
    const context = await browser.newContext({ viewport: vp, serviceWorkers: 'block', acceptDownloads: false });
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (/^(about:|data:|blob:)/i.test(url)) return route.continue();
        blocked.add(url.slice(0, 200));
        return route.abort();
      });
      const page = await context.newPage();
      const ctx = { errors: [], trialErrors: [], buttons: new Map(), steps: 0, truncated: false };
      page.on('pageerror', (e) => ctx.errors.push('pageerror: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200)));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (/Failed to load resource/i.test(text) && blocked.size) return; // reported by H5
        ctx.errors.push('console.error: ' + text.split('\n')[0].slice(0, 200));
      });
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      page.on('popup', (p) => p.close().catch(() => {}));

      let loaded = true;
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
      } catch (e) {
        loaded = false;
        fail('H3', label + ': không nạp được trang (' + String(e.message).split('\n')[0].slice(0, 100) + ')');
      }

      if (loaded) {
        const ready = await page.waitForFunction(() => window.gameReady === true, null, { timeout: READY_TIMEOUT_MS }).then(() => true, () => false);
        if (!ready) fail('H3', label + ': window.gameReady chưa bằng true sau 5 giây');
        const errBox = await page.$('#gameErrorBox');
        if (errBox) fail('H3', label + ': có phần tử #gameErrorBox');

        const scroll = await evalPage(page, PAGE.scrollInfo);
        if (scroll.scrollWidth > scroll.innerWidth + 1 || scroll.scrollHeight > scroll.innerHeight + 1) {
          fail('H4', label + ': nội dung ' + scroll.scrollWidth + '×' + scroll.scrollHeight + ' lớn hơn cửa sổ ' + scroll.innerWidth + '×' + scroll.innerHeight);
        }
        (await evalPage(page, PAGE.visibleTexts)).forEach((t) => allTexts.add(t));
        if (await evalPage(page, PAGE.hasResetButton)) hasReset = true;
        screenshots.push(await shot(page, runDir, 'ready', vp));

        if (vp.width === 1920) {
          const font = await evalPage(page, PAGE.minFontInfo);
          if (font.min !== null && font.min < 14) warn('S3', 'Cỡ chữ ' + font.min + 'px ("' + font.sample + '")');

          await evalPage(page, PAGE.installTools);
          await runTrial(page, ctx);
          trialCtx = ctx;

          // After the trial: re-check scrolling and take the "after" screenshot at both sizes.
          for (const after of [vp, VIEWPORTS[0]]) {
            const afterLabel = after.width + '×' + after.height;
            if (after !== vp) { await page.setViewportSize(after); await sleep(200); }
            const s2 = await evalPage(page, PAGE.scrollInfo);
            if (s2.scrollWidth > s2.innerWidth + 1 || s2.scrollHeight > s2.innerHeight + 1) {
              fail('H4', afterLabel + ' (sau thao tác): nội dung ' + s2.scrollWidth + '×' + s2.scrollHeight + ' lớn hơn cửa sổ ' + s2.innerWidth + '×' + s2.innerHeight);
            }
            screenshots.push(await shot(page, runDir, 'after', after));
          }
          (await evalPage(page, PAGE.visibleTexts)).forEach((t) => allTexts.add(t));
        }
      }
      for (const e of ctx.errors) if (!errorMessages.has(e)) errorMessages.set(e, label);
    } catch (e) {
      fail('H3', label + ': lỗi khi kiểm tra (' + String(e.message).split('\n')[0].slice(0, 120) + ')');
    } finally {
      await context.close().catch(() => {});
    }
  }

  // H2 / H5
  for (const [msg, vpLabel] of errorMessages) fail('H2', vpLabel + ': ' + msg);
  for (const url of blocked) fail('H5', 'Request mạng bị chặn: ' + url);

  // H7 / S4 (from the 1920×1080 trial)
  if (trialCtx) {
    for (const e of trialCtx.trialErrors.slice(0, 10)) fail('H7', e);
    for (const rec of trialCtx.buttons.values()) {
      if (rec.clicks > 0 && !rec.changed) warn('S4', 'Nút "' + rec.label + '" bấm ' + rec.clicks + ' lần nhưng không đổi DOM hay canvas');
      else if (rec.clicks === 0 && rec.failures > 0) warn('S4', 'Nút "' + rec.label + '" không bấm được (' + rec.lastFailure + ')');
    }
  }

  // H8: a button labelled "Làm lại" (looked up on the loaded pages above).
  if (!hasReset) fail('H8', 'Không tìm thấy nút có chữ "Làm lại"');

  // H6 / S1 / S5 on the collected visible text
  const text = [...allTexts].join('\n');
  const stopHits = findStoplistHits(text, stoplist);
  if (stopHits.length) fail('H6', 'Từ tiếng Anh: ' + stopHits.map((h) => h.word + (h.count > 1 ? ' ×' + h.count : '')).join(', '));
  const stopWords = new Set(stopHits.map((h) => h.word));
  for (const w of findSuspectEnglish(text, stoplist)) if (!stopWords.has(w.toLowerCase())) warn('S1', w);
  const latex = text.match(/\$|\\|\*\*/g);
  if (latex) warn('S5', 'Có ' + latex.length + ' ký tự nghi LaTeX / markdown ($, \\, **)');

  const hardFailures = HARD_IDS.filter((id) => !hard[id].pass).map((id) => ({ id, title: HARD_TITLES[id], message: hard[id].details.join(' | ') || HARD_TITLES[id] }));
  const softWarnings = SOFT_IDS.filter((id) => soft[id].count > 0).map((id) => ({ id, title: SOFT_TITLES[id], count: soft[id].count, message: soft[id].items.slice(0, 8).join(' | ') }));

  return {
    passed: hardFailures.length === 0,
    checks: hard,
    soft,
    hardFailures,
    softWarnings,
    screenshots: screenshots.filter(Boolean),
    englishHits: stopHits,
    trial: trialCtx ? { steps: trialCtx.steps, truncated: trialCtx.truncated } : null,
    ms: Date.now() - started,
  };
}

module.exports = { runChecker, closeBrowser, HARD_IDS, SOFT_IDS, HARD_TITLES, SOFT_TITLES };
