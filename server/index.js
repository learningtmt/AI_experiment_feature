'use strict';
// Express server for the "Tạo thí nghiệm tương tác" prototype.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ROOT, env, envBool, envInt } = require('./env');
const { getProvider } = require('./data-provider');
const { loadWhitelist, filterSubjects } = require('./subjects');
const { lessonsFromResponse } = require('./lessons');
const { runDescribe, runExperiment } = require('./pipeline');
const { runsRoot } = require('./runs');
const { closeBrowser } = require('./checker');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const provider = getProvider();
  const appCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'app.json'), 'utf8'));
  const BOOK = appCfg.bookGroupCode || 'KNTT';

  // ---- static + shared browser/server modules -------------------------------------------------
  app.get('/shared/resolve.js', (_req, res) => res.sendFile(path.join(__dirname, 'resolve.js')));
  app.get('/shared/vn-text.js', (_req, res) => res.sendFile(path.join(__dirname, 'vn-text.js')));
  app.use(express.static(path.join(ROOT, 'public')));

  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const bad = (res, msg) => res.status(400).json({ ok: false, error: msg });

  // Abort the model call when the client disconnects before the response is finished.
  function abortSignal(res) {
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    return ac.signal;
  }

  function sendError(res, err) {
    if (err && err.kind === 'aborted') return; // client is gone
    console.log('[error] ' + (err && err.kind ? err.kind : 'internal') + ': ' + String((err && err.message) || err).slice(0, 200));
    if (res.headersSent) return;
    res.status(502).json({ ok: false, kind: (err && err.kind) || 'internal', error: (err && err.message) || 'Lỗi không xác định' });
  }

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => sendError(res, e));

  // ---- data -------------------------------------------------------------------------------------
  app.get('/api/config', (_req, res) => {
    const perCall = envInt('REQUEST_TIMEOUT_MS', 240000);
    const attempts = envInt('MAX_ATTEMPTS', 3);
    res.json({
      ok: true,
      model: envBool('LLM_MOCK', false) ? 'mock' : env('MODEL_ID', ''),
      mock: envBool('LLM_MOCK', false),
      provider: provider.name,
      defaultVariant: env('EXPERIMENT_PROMPT_VARIANT', 'vi'),
      checker: envBool('ENABLE_CHECKER', true),
      // Client-side waits: describe = one model call; experiment = every attempt plus checker time.
      describeTimeoutMs: perCall + 20000,
      experimentTimeoutMs: perCall * attempts + 90000 * attempts,
    });
  });

  app.get('/api/subjects', wrap(async (_req, res) => {
    const { shown } = filterSubjects(await provider.getSubjects(), loadWhitelist());
    res.json({ ok: true, subjects: shown.map((s) => ({ id: s.id, name: s.name })) });
  }));

  app.get('/api/classes', wrap(async (req, res) => {
    const subjectCode = str(req.query.subjectCode);
    if (!subjectCode) return bad(res, 'Thiếu subjectCode');
    const groups = await provider.getBookGroups(subjectCode);
    const book = groups.find((g) => g.id === BOOK);
    if (!book) return res.json({ ok: true, classes: [], noBook: true, message: 'Môn này chưa có sách Kết nối tri thức' });
    res.json({ ok: true, classes: (book.itemClasses || []).map((c) => ({ id: c.id, name: c.name })), noBook: false });
  }));

  app.post('/api/lessons', wrap(async (req, res) => {
    const subjectCode = str(req.body && req.body.subjectCode);
    const gradeCode = str(req.body && req.body.gradeCode);
    if (!subjectCode || !gradeCode) return bad(res, 'Thiếu subjectCode hoặc gradeCode');
    const resp = await provider.getNodeKnowledge({ subjectCode, bookGroupCode: BOOK, gradeCodes: [gradeCode] });
    res.json({ ok: true, lessons: lessonsFromResponse(resp) });
  }));

  // ---- AI ---------------------------------------------------------------------------------------
  app.post('/api/describe', wrap(async (req, res) => {
    const b = req.body || {};
    const input = { subject: str(b.subject), class: str(b.class), explain: str(b.explain), current: str(b.current), note: str(b.note) };
    if (!input.subject || !input.class || !input.explain) return bad(res, 'Thiếu Môn, Lớp hoặc Bài học');
    const r = await runDescribe(input, { signal: abortSignal(res) });
    const { raw, runDir, ...out } = r;
    res.json(out);
  }));

  app.post('/api/experiment', wrap(async (req, res) => {
    const b = req.body || {};
    const input = { subject: str(b.subject), class: str(b.class), explain: str(b.explain), experiment: str(b.experiment), note: str(b.note) };
    if (!input.subject || !input.class || !input.explain) return bad(res, 'Thiếu Môn, Lớp hoặc Bài học');
    if (input.experiment.trim() === '') return bad(res, 'Thiếu mô tả thí nghiệm');
    const variant = str(b.variant) || env('EXPERIMENT_PROMPT_VARIANT', 'vi');
    if (!['vi', 'en'].includes(variant)) return bad(res, 'variant phải là vi hoặc en');
    const r = await runExperiment(input, { signal: abortSignal(res), variant });
    const { lastHtml, ...out } = r;
    res.json(out);
  }));

  // Dev panel: read a file of a run folder (whitelisted names only).
  app.get('/api/run-file', (req, res) => {
    const dir = str(req.query.dir);
    const file = str(req.query.file);
    if (!/^[A-Za-z0-9._-]+$/.test(dir) || dir.includes('..')) return bad(res, 'dir không hợp lệ');
    const allowed = /^(prompt\.txt|raw\.txt|report\.json|output\.html|screens\/[a-z]+-\d+x\d+\.png)$/;
    if (!allowed.test(file)) return bad(res, 'file không hợp lệ');
    const full = path.join(runsRoot(), dir, file);
    if (!fs.existsSync(full)) return res.status(404).json({ ok: false, error: 'Không tìm thấy file' });
    if (file.endsWith('.png')) return res.type('png').sendFile(full);
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(full, 'utf8'));
  });

  app.use((err, _req, res, _next) => {
    console.log('[error] ' + String(err && err.message).slice(0, 200));
    res.status(err.status || 500).json({ ok: false, error: err.status === 400 ? 'Dữ liệu gửi lên không hợp lệ' : 'Lỗi máy chủ' });
  });

  return app;
}

async function start() {
  const port = envInt('PORT', 3000);
  const provider = getProvider();
  const app = createApp();
  try {
    const { excluded } = filterSubjects(await provider.getSubjects(), loadWhitelist());
    console.log('Môn bị loại bởi bộ lọc (' + excluded.length + '): ' + (excluded.join(' | ') || '(không có)'));
  } catch (e) {
    console.log('Không đọc được danh sách môn lúc khởi động: ' + e.message);
  }
  // Bound to loopback on purpose: the app spends model quota and has no login.
  const server = app.listen(port, '127.0.0.1', () => {
    console.log('Ứng dụng chạy tại http://localhost:' + port
      + ' | provider=' + provider.name
      + ' | model=' + (envBool('LLM_MOCK', false) ? 'mock' : env('MODEL_ID', '(chưa đặt)'))
      + ' | checker=' + envBool('ENABLE_CHECKER', true)
      + ' | variant=' + env('EXPERIMENT_PROMPT_VARIANT', 'vi'));
  });
  const shutdown = async () => { server.close(); await closeBrowser(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) start();

module.exports = { createApp, start };
