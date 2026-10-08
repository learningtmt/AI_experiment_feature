'use strict';
// Eval runner: node eval/run-eval.js --variants vi,en [--limit N] [--attempts 1] [--cases eval/cases.json] [--only id1,id2]
// Reads eval/cases.json (never modifies it). Writes eval/results/<ISO-time>/{summary.json, report.md, gallery.html, runs/}.
const fs = require('fs');
const path = require('path');
const { ROOT, env, envBool } = require('../server/env');
const { runDescribe, runExperiment } = require('../server/pipeline');
const { closeBrowser, HARD_IDS, SOFT_IDS, HARD_TITLES, SOFT_TITLES } = require('../server/checker');

function parseArgs(argv) {
  const args = { variants: ['vi', 'en'], limit: Infinity, attempts: 1, cases: path.join(ROOT, 'eval', 'cases.json'), only: null };
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i].split('=');
    const val = () => (inline !== undefined ? inline : argv[++i]);
    if (k === '--variants') args.variants = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--limit') args.limit = parseInt(val(), 10);
    else if (k === '--attempts') args.attempts = parseInt(val(), 10);
    else if (k === '--cases') args.cases = path.resolve(val());
    else if (k === '--only') args.only = val().split(',').map((s) => s.trim());
    else throw new Error('Tham số không hợp lệ: ' + argv[i]);
  }
  for (const v of args.variants) if (!['vi', 'en'].includes(v)) throw new Error('variant phải là vi hoặc en: ' + v);
  if (!Number.isFinite(args.attempts) || args.attempts < 1) throw new Error('--attempts phải >= 1');
  return args;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wordCount = (t) => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0);
const mark = (v) => (v === true ? '✔' : v === false ? '✖' : '–');
const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
const rel = (from, to) => path.relative(from, to).split(path.sep).join('/');

// Flags of the FIRST attempt (measures first-try stability), plus the final outcome.
function summarizeVariant(variant, result, outDir) {
  const first = result.attempts[0];
  const checks = {};
  const soft = {};
  HARD_IDS.forEach((id) => { checks[id] = first.checker ? first.checker.checks[id].pass : (id === 'H1' && first.kind === 'html' ? first.structureErrors.length === 0 : null); });
  SOFT_IDS.forEach((id) => { soft[id] = first.checker ? first.checker.soft[id].count : null; });
  return {
    variant,
    kind: result.kind,                       // html | not_suitable | unstable (final, after all attempts)
    firstKind: first.kind,
    attempts: result.attempts.length,
    passedFirst: first.kind === 'html' ? first.passed : null,
    checks, soft,
    hardFailures: first.hardFailures || [],
    softWarnings: first.softWarnings || [],
    h6Words: first.checker ? first.checker.englishHits : [],
    s1Words: first.checker ? first.checker.soft.S1.items : [],
    ms: first.ms,
    checkerMs: first.checkerMs || null,
    usage: first.usage,
    reason: result.reason || (first.kind === 'not_suitable' ? first.reason : null),
    runId: first.runId,
    outputHtml: first.kind === 'html' ? rel(outDir, path.join(first.runDir, 'output.html')) : null,
    screens: (first.screens || []).map((s) => rel(outDir, path.join(first.runDir, s))),
    raw: first.kind !== 'html' ? readIf(path.join(first.runDir, 'raw.txt')) : null,
    error: first.error || null,
    checkerError: first.checkerError || null,
  };
}

function aggregate(variant, rows) {
  const html = rows.filter((r) => r.firstKind === 'html');
  const rate = {};
  HARD_IDS.forEach((id) => {
    const measured = html.filter((r) => r.checks[id] !== null);
    rate[id] = { pass: measured.filter((r) => r.checks[id]).length, total: measured.length };
  });
  const allPass = html.filter((r) => r.passedFirst).length;
  const sum = (f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  return {
    variant,
    cases: rows.length,
    kinds: { html: rows.filter((r) => r.firstKind === 'html').length, not_suitable: rows.filter((r) => r.firstKind === 'not_suitable').length, error: rows.filter((r) => r.firstKind === 'error').length },
    finalUnstable: rows.filter((r) => r.kind === 'unstable').length,
    firstAttemptAllHardPass: { pass: allPass, total: html.length },
    hardRates: rate,
    englishH6Cases: html.filter((r) => r.checks.H6 === false).length,
    englishH6Words: html.reduce((a, r) => a + (r.h6Words || []).reduce((n, w) => n + w.count, 0), 0),
    s1Words: sum((r) => (r.s1Words ? r.s1Words.length : 0)),
    softTotals: Object.fromEntries(SOFT_IDS.map((id) => [id, sum((r) => r.soft[id])])),
    avgMs: rows.length ? Math.round(sum((r) => r.ms) / rows.length) : 0,
    totalTokens: sum((r) => (r.usage ? r.usage.total_tokens : 0)),
  };
}

// ---- report.md ---------------------------------------------------------------------------------------
function buildReport(summary) {
  const L = [];
  const v = summary.args.variants;
  L.push('# Báo cáo eval', '');
  L.push('- Thời gian: ' + summary.startedAt);
  L.push('- Model: `' + summary.model + '`' + (summary.mock ? ' (LLM_MOCK, không gọi model thật)' : ''));
  L.push('- Variants: ' + v.join(', ') + ' | số lần thử tối đa mỗi variant: ' + summary.args.attempts + ' | số case: ' + summary.cases.length);
  L.push('- Cột H1..H9 là kết quả của **lần thử đầu tiên**. ✔ đạt, ✖ không đạt, – không đo được. S1..S5 là số cảnh báo.', '');

  L.push('## Mô tả sinh bởi prompt 1', '');
  L.push('| Case | Flow | Kết quả | Số từ | Cảnh báo định dạng | Thời gian (giây) | Token |', '|---|---|---|---|---|---|---|');
  for (const c of summary.cases) {
    if (!c.describe) { L.push('| ' + c.id + ' | ' + c.flow + ' | (không chạy prompt 1) | | | | |'); continue; }
    const d = c.describe;
    L.push('| ' + c.id + ' | ' + c.flow + ' | ' + (d.error ? 'LỖI: ' + d.error : d.kind === 'not_suitable' ? 'KHONG_PHU_HOP' : 'mô tả') + ' | ' + (d.words ?? '') + ' | ' + ((d.warnings || []).join('; ') || '–') + ' | ' + (d.ms / 1000).toFixed(1) + ' | ' + (d.usage ? d.usage.total_tokens : '–') + ' |');
  }
  const descCases = summary.cases.filter((c) => c.describe && !c.describe.error);
  const refused = descCases.filter((c) => c.describe.kind === 'not_suitable');
  L.push('', 'Tỉ lệ từ chối của prompt 1: ' + refused.length + '/' + descCases.length + (refused.length ? ' (' + refused.map((c) => c.id).join(', ') + ')' : '') + '.', '');

  L.push('## Bảng case × variant', '');
  L.push('| Case | Variant | Kết quả | ' + HARD_IDS.join(' | ') + ' | ' + SOFT_IDS.join(' | ') + ' | Giây | Token |');
  L.push('|---|---|---|' + HARD_IDS.concat(SOFT_IDS).map(() => '---').join('|') + '|---|---|');
  for (const c of summary.cases) {
    for (const x of Object.values(c.variants)) {
      const kind = x.kind === 'html' ? (x.passedFirst ? 'html' : 'html (lần 1 chưa đạt)') : x.kind === 'unstable' ? 'unstable' : x.kind === 'not_suitable' ? 'KHONG_PHU_HOP' : (x.error ? 'LỖI' : x.kind);
      L.push('| ' + c.id + ' | ' + x.variant + ' | ' + kind + ' | ' + HARD_IDS.map((id) => mark(x.checks[id])).join(' | ') + ' | ' + SOFT_IDS.map((id) => (x.soft[id] === null ? '–' : x.soft[id])).join(' | ') + ' | ' + (x.ms / 1000).toFixed(1) + ' | ' + (x.usage ? x.usage.total_tokens : '–') + ' |');
    }
  }

  L.push('', '## Tỉ lệ đạt kiểm tra bắt buộc ở lần thử đầu, theo variant', '');
  L.push('| Variant | Số case có HTML | Đạt tất cả H | ' + HARD_IDS.join(' | ') + ' |', '|---|---|---|' + HARD_IDS.map(() => '---').join('|') + '|');
  for (const a of summary.aggregates) {
    const pct = (r) => (r.total ? r.pass + '/' + r.total + ' (' + Math.round((100 * r.pass) / r.total) + '%)' : '–');
    L.push('| ' + a.variant + ' | ' + a.firstAttemptAllHardPass.total + ' | ' + pct(a.firstAttemptAllHardPass) + ' | ' + HARD_IDS.map((id) => pct(a.hardRates[id])).join(' | ') + ' |');
  }

  L.push('', '## Từ tiếng Anh bị bắt, theo variant', '');
  L.push('| Variant | Case vướng H6 | Số từ bị bắt (H6) | Từ nghi tiếng Anh (S1) | Cảnh báo S2 | S3 | S4 | S5 | Giây trung bình | Tổng token |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const a of summary.aggregates) {
    L.push('| ' + a.variant + ' | ' + a.englishH6Cases + ' | ' + a.englishH6Words + ' | ' + a.s1Words + ' | ' + a.softTotals.S2 + ' | ' + a.softTotals.S3 + ' | ' + a.softTotals.S4 + ' | ' + a.softTotals.S5 + ' | ' + (a.avgMs / 1000).toFixed(1) + ' | ' + a.totalTokens + ' |');
  }

  const problems = [];
  for (const c of summary.cases) for (const x of Object.values(c.variants)) {
    if (x.hardFailures.length) problems.push('- **' + c.id + ' / ' + x.variant + '**: ' + x.hardFailures.map((f) => f.id + ' ' + f.message).join(' || '));
    if (x.error) problems.push('- **' + c.id + ' / ' + x.variant + '**: lỗi gọi model: ' + x.error);
    if (x.checkerError) problems.push('- **' + c.id + ' / ' + x.variant + '**: bộ kiểm tra lỗi: ' + x.checkerError);
  }
  L.push('', '## Chi tiết các kiểm tra bắt buộc không đạt (lần thử đầu)', '', problems.length ? problems.join('\n') : 'Không có.');
  L.push('', '## Chú thích', '', ...HARD_IDS.map((id) => '- ' + id + ': ' + HARD_TITLES[id]), ...SOFT_IDS.map((id) => '- ' + id + ': ' + SOFT_TITLES[id]));
  L.push('', 'Lỗi kiến thức (AC1, AC2) do người rà soát ghi tay trong `gallery.html`; chưa tự động hóa.', '');
  return L.join('\n');
}

// ---- gallery.html ---------------------------------------------------------------------------------------
function buildGallery(summary) {
  const v = summary.args.variants;
  const rows = summary.cases.map((c) => {
    const left = [
      '<h3>' + esc(c.id) + '</h3>',
      '<div class="meta">' + esc(c.test) + ' · ' + esc(c.flow) + ' · AC: ' + esc((c.ac || []).join(', ')) + '</div>',
      '<div class="meta">' + esc(c.subject) + ' · ' + esc(c.class) + '<br>' + esc(c.explain) + '</div>',
      c.describe && c.describe.kind === 'description' ? '<h4>Mô tả đã dùng (do AI viết' + (c.describe.words ? ', ' + c.describe.words + ' từ' : '') + ')</h4><pre>' + esc(c.experimentText) + '</pre>'
        : c.flow === 'experiment-only' ? '<h4>Mô tả đã dùng (thầy cô nhập)</h4><pre>' + esc(c.experimentText) + '</pre>' : '',
      c.describe && c.describe.kind === 'not_suitable' ? '<h4>Prompt 1 từ chối</h4><pre>' + esc(c.describe.raw) + '</pre>' : '',
      c.describe && c.describe.error ? '<p class="bad">Prompt 1 lỗi: ' + esc(c.describe.error) + '</p>' : '',
      c.flow === 'describe-only' && c.describe && c.describe.kind === 'description' ? '<h4>Đầu ra thô của prompt 1</h4><pre>' + esc(c.describe.raw) + '</pre>' : '',
      '<h4>Cần kiểm (expect)</h4><ul>' + (c.expect || []).map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul>',
    ].join('');
    const cells = v.map((name) => {
      const x = c.variants[name];
      if (!x) return '<td class="variant"><em>' + (c.flow === 'describe-only' ? 'Case chỉ chạy prompt 1' : 'Không chạy prompt 2') + '</em></td>';
      const badge = x.error ? '<span class="bad">LỖI GỌI MODEL</span>' : x.kind === 'not_suitable' ? '<span class="warn">KHONG_PHU_HOP</span>' : x.passedFirst ? '<span class="ok">Đạt H1..H9 (lần 1)</span>' : '<span class="bad">Không đạt: ' + esc(x.hardFailures.map((f) => f.id).join(', ') || x.kind) + '</span>';
      const shots = x.screens.filter((s) => /1920x1080/.test(s)).map((s) => '<a href="' + esc(s) + '"><img src="' + esc(s) + '" alt=""></a>').join('');
      return '<td class="variant"><div class="head">' + esc(name) + ' · ' + badge + ' · ' + (x.ms / 1000).toFixed(1) + ' giây · ' + (x.usage ? x.usage.total_tokens + ' token' : '') + '</div>'
        + (x.outputHtml ? '<iframe sandbox="allow-scripts" src="' + esc(x.outputHtml) + '"></iframe><div class="shots">' + shots + '</div>' : '')
        + (x.kind === 'not_suitable' || x.error ? '<pre>' + esc(x.raw || x.error || x.reason) + '</pre>' : '')
        + (x.hardFailures.length ? '<ul class="fails">' + x.hardFailures.map((f) => '<li>' + esc(f.id) + ': ' + esc(f.message) + '</li>').join('') + '</ul>' : '')
        + (x.softWarnings.length ? '<div class="soft">' + x.softWarnings.map((w) => esc(w.id) + ' (' + w.count + ')').join(' · ') + '</div>' : '')
        + '</td>';
    }).join('');
    const review = (label) => '<td class="review">' + v.map((n) => '<label>' + esc(n) + ' <input type="text" size="3" aria-label="' + esc(label + ' ' + n) + '"></label>').join('<br>') + '</td>';
    return '<tr><td class="case">' + left + '</td>' + cells + review('AC1') + review('AC2') + '</tr>';
  }).join('\n');
  return '<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Gallery eval</title><style>'
    + 'body{font-family:system-ui,Arial,sans-serif;margin:16px;color:#1b2733}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c9d1d9;vertical-align:top;padding:8px}'
    + 'th{background:#eef1f4}.case{width:26%;font-size:14px}.variant{width:26%}.review{width:5%;font-size:13px}iframe{width:100%;aspect-ratio:16/9;border:1px solid #c9d1d9}pre{white-space:pre-wrap;font-size:12px;background:#f6f8fa;padding:6px;max-height:260px;overflow:auto}'
    + '.ok{color:#2e7d32;font-weight:600}.bad{color:#c62828;font-weight:600}.warn{color:#b26a00;font-weight:600}.meta{color:#57606a;font-size:13px}.shots img{width:48%;border:1px solid #ccc;margin:2px}.fails,.soft{font-size:12px}h3,h4{margin:6px 0}'
    + '</style></head><body><h1>Gallery eval · ' + esc(summary.startedAt) + '</h1><p>Model: ' + esc(summary.model) + ' · variants: ' + esc(v.join(', ')) + '. Hai cột cuối để người rà soát ghi tay ✔/✖ cho từng variant.</p>'
    + '<table><thead><tr><th>Case, mô tả đã dùng, expect</th>' + v.map((n) => '<th>Variant ' + esc(n) + '</th>').join('') + '<th>AC1 đúng hiện tượng (✔/✖)</th><th>AC2 đúng kiến thức (✔/✖)</th></tr></thead><tbody>\n' + rows + '\n</tbody></table></body></html>';
}

// ---- main -------------------------------------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  let cases = JSON.parse(fs.readFileSync(args.cases, 'utf8'));
  if (args.only) cases = cases.filter((c) => args.only.includes(c.id));
  cases = cases.slice(0, args.limit);

  const startedAt = new Date().toISOString();
  const outDir = path.join(ROOT, 'eval', 'results', startedAt.replace(/[:.]/g, '-'));
  const runsBase = path.join(outDir, 'runs');
  fs.mkdirSync(runsBase, { recursive: true });
  const mock = envBool('LLM_MOCK', false);
  console.log('Eval: ' + cases.length + ' case × variants [' + args.variants.join(',') + '], attempts=' + args.attempts + (mock ? ' (LLM_MOCK)' : '') + '\nKết quả: ' + path.relative(ROOT, outDir));

  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const tag = '[' + (i + 1) + '/' + cases.length + '] ' + c.id;
    const entry = { id: c.id, test: c.test, ac: c.ac, flow: c.flow, subject: c.subject, class: c.class, explain: c.explain, teacherDescription: c.teacherDescription, note: c.note, expect: c.expect, describe: null, experimentText: null, variants: {} };
    results.push(entry);

    // Prompt 1 (once per case; the same description feeds every variant).
    let experimentText = null;
    if (c.flow === 'experiment-only') {
      experimentText = c.teacherDescription;
    } else {
      console.log(tag + ' · prompt 1 (' + (c.teacherDescription ? 'hoàn thiện' : 'tạo mới') + ')');
      try {
        const d = await runDescribe({ subject: c.subject, class: c.class, explain: c.explain, current: c.teacherDescription || '', note: c.note || '' }, { baseDir: runsBase, slug: c.id + '-describe' });
        entry.describe = { kind: d.kind, ms: d.ms, usage: d.usage, warnings: d.warnings, runId: d.runId, raw: d.raw, words: d.kind === 'description' ? wordCount(d.text) : null, reason: d.reason || null };
        if (d.kind === 'description') experimentText = d.text;
        else console.log(tag + ' · prompt 1 từ chối: ' + d.reason);
      } catch (e) {
        entry.describe = { kind: 'error', error: e.message, ms: 0, usage: null, warnings: [] };
        console.log(tag + ' · prompt 1 lỗi: ' + e.message);
      }
    }
    entry.experimentText = experimentText;
    if (c.flow === 'describe-only' || experimentText === null) continue;

    // Prompt 2 per variant.
    for (const variant of args.variants) {
      console.log(tag + ' · prompt 2 [' + variant + ']');
      try {
        const r = await runExperiment(
          { subject: c.subject, class: c.class, explain: c.explain, experiment: experimentText, note: c.note || '' },
          { variant, maxAttempts: args.attempts, baseDir: runsBase, slug: c.id + '-' + variant },
        );
        entry.variants[variant] = summarizeVariant(variant, r, outDir);
      } catch (e) {
        entry.variants[variant] = { variant, kind: 'error', firstKind: 'error', attempts: 0, passedFirst: null, checks: Object.fromEntries(HARD_IDS.map((id) => [id, null])), soft: Object.fromEntries(SOFT_IDS.map((id) => [id, null])), hardFailures: [], softWarnings: [], s1Words: [], h6Words: [], ms: 0, usage: null, error: e.message, screens: [] };
        console.log(tag + ' · prompt 2 [' + variant + '] lỗi: ' + e.message);
      }
    }
  }

  const aggregates = args.variants.map((variant) => aggregate(variant, results.map((r) => r.variants[variant]).filter(Boolean)));
  const summary = { startedAt, args: { ...args, limit: Number.isFinite(args.limit) ? args.limit : null, cases: path.relative(ROOT, args.cases) }, model: mock ? 'mock' : env('MODEL_ID', ''), mock, cases: results, aggregates };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), buildReport(summary));
  fs.writeFileSync(path.join(outDir, 'gallery.html'), buildGallery(summary));
  console.log('\nXong. Mở: ' + path.join(path.relative(ROOT, outDir), 'gallery.html') + ' và report.md');
  await closeBrowser();
}

main().catch(async (e) => { console.error('Lỗi eval:', e && e.message); await closeBrowser(); process.exit(1); });
