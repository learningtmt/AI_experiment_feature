'use strict';
// Core flows shared by the HTTP server and the eval runner: describe (prompt 1) and experiment (prompt 2).
const path = require('path');
const { envBool, envInt, env } = require('./env');
const { buildDescribePrompt, buildExperimentPrompt } = require('./prompts');
const { generate, LlmError } = require('./llm');
const { cleanDescription, cleanHtml } = require('./postprocess');
const { runChecker } = require('./checker');
const { createRun, writeFile } = require('./runs');

function lessonSlug(explain) {
  const parts = String(explain || '').split('>');
  return parts[parts.length - 1].trim() || 'bai-hoc';
}

function logMeta(tag, meta) {
  // Metadata only: never prompt text, never keys.
  console.log('[' + tag + '] ' + Object.entries(meta).map(([k, v]) => k + '=' + v).join(' '));
}

function tokensOf(usage) {
  return usage && usage.total_tokens != null ? usage.total_tokens : '-';
}

// ---- prompt 1 ------------------------------------------------------------------------------
async function runDescribe(input, { signal, baseDir, slug } = {}) {
  const prompt = buildDescribePrompt({
    subject: input.subject, class: input.class, explain: input.explain, current: input.current, note: input.note,
  });
  const run = createRun({ kind: 'describe', slug: slug || lessonSlug(input.explain), baseDir });
  writeFile(run.dir, 'prompt.txt', prompt);

  let llm;
  try {
    llm = await generate(prompt, { kind: 'describe', signal });
  } catch (err) {
    writeFile(run.dir, 'report.json', JSON.stringify({ kind: 'error', error: err.message, errorKind: err.kind, status: err.status }, null, 2));
    throw err;
  }
  writeFile(run.dir, 'raw.txt', llm.text);
  const cleaned = cleanDescription(llm.text);
  if (cleaned.kind === 'description' && cleaned.text.trim() === '') {
    writeFile(run.dir, 'report.json', JSON.stringify({ kind: 'error', error: 'empty output', usage: llm.usage }, null, 2));
    throw new LlmError('Model trả về nội dung rỗng.', { kind: 'api' });
  }
  const report = { kind: cleaned.kind, model: llm.model, api: llm.api, mock: llm.mock, ms: llm.ms, wallMs: llm.wallMs || llm.ms, retries: llm.retries || [], usage: llm.usage, finishReason: llm.finishReason || null, warnings: cleaned.warnings };
  writeFile(run.dir, 'report.json', JSON.stringify(report, null, 2));
  logMeta('describe', { kind: cleaned.kind, ms: llm.ms, tokens: tokensOf(llm.usage), run: run.id });

  const base = { ok: true, kind: cleaned.kind, warnings: cleaned.warnings, usage: llm.usage, ms: llm.ms, runId: run.id, runDir: run.dir, raw: llm.text };
  return cleaned.kind === 'description' ? { ...base, text: cleaned.text } : { ...base, reason: cleaned.reason };
}

// ---- prompt 2 ------------------------------------------------------------------------------
function summarizeChecker(c) {
  if (!c) return null;
  const checks = {};
  for (const [id, v] of Object.entries(c.checks)) checks[id] = { pass: v.pass, title: v.title, details: v.details };
  return { passed: c.passed, ms: c.ms, trial: c.trial, checks, soft: c.soft, englishHits: c.englishHits, screenshots: c.screenshots };
}

async function runExperimentAttempt(input, { n, variant, signal, baseDir, slug, enableChecker }) {
  const prompt = buildExperimentPrompt({
    subject: input.subject, class: input.class, explain: input.explain, experiment: input.experiment, note: input.note,
  }, variant);
  const run = createRun({ kind: 'experiment', slug: slug || lessonSlug(input.explain), baseDir });
  writeFile(run.dir, 'prompt.txt', prompt);

  const attempt = { n, runId: run.id, runDir: run.dir, variant, ms: 0, usage: null, kind: 'error', passed: false, hardFailures: [], softWarnings: [], structureErrors: [], screens: [] };
  let llm;
  try {
    llm = await generate(prompt, { kind: 'experiment', signal });
  } catch (err) {
    if (err.kind === 'aborted') throw err;
    attempt.error = err.message;
    attempt.errorKind = err.kind;
    writeFile(run.dir, 'report.json', JSON.stringify({ kind: 'error', variant, error: err.message, errorKind: err.kind, status: err.status }, null, 2));
    logMeta('experiment', { attempt: n, variant, kind: 'error', error: err.kind });
    return attempt;
  }
  attempt.ms = llm.ms;
  attempt.retries = llm.retries || [];
  attempt.wallMs = llm.wallMs || llm.ms;
  attempt.usage = llm.usage;
  attempt.model = llm.model;
  attempt.raw = llm.text;
  writeFile(run.dir, 'raw.txt', llm.text);

  const cleaned = cleanHtml(llm.text);
  attempt.kind = cleaned.kind;
  if (cleaned.kind === 'not_suitable') {
    attempt.reason = cleaned.reason;
    attempt.passed = true;
    writeFile(run.dir, 'report.json', JSON.stringify({ kind: 'not_suitable', variant, reason: cleaned.reason, model: llm.model, ms: llm.ms, usage: llm.usage }, null, 2));
    logMeta('experiment', { attempt: n, variant, kind: 'not_suitable', ms: llm.ms, tokens: tokensOf(llm.usage) });
    return attempt;
  }

  attempt.html = cleaned.html;
  attempt.structureErrors = cleaned.structureErrors;
  writeFile(run.dir, 'output.html', cleaned.html);

  let checker = null;
  if (enableChecker) {
    try {
      checker = await runChecker(cleaned.html, { runDir: run.dir });
    } catch (err) {
      attempt.checkerError = String(err && err.message || err).split('\n')[0].slice(0, 300);
    }
  }
  if (checker) {
    attempt.passed = checker.passed;
    attempt.hardFailures = checker.hardFailures;
    attempt.softWarnings = checker.softWarnings;
    attempt.checker = summarizeChecker(checker);
    attempt.screens = checker.screenshots.map((f) => path.relative(run.dir, f).split(path.sep).join('/'));
    attempt.checkerMs = checker.ms;
  } else {
    // Checker disabled or broken: only the structure check decides.
    attempt.passed = cleaned.structureErrors.length === 0;
    attempt.hardFailures = cleaned.structureErrors.map((m) => ({ id: 'H1', title: 'Cấu trúc HTML hợp lệ', message: m }));
  }
  writeFile(run.dir, 'report.json', JSON.stringify({
    kind: 'html', variant, model: llm.model, api: llm.api, mock: llm.mock, ms: llm.ms, wallMs: attempt.wallMs, retries: attempt.retries, usage: llm.usage, finishReason: llm.finishReason || null,
    passed: attempt.passed, structureErrors: cleaned.structureErrors, hardFailures: attempt.hardFailures, softWarnings: attempt.softWarnings,
    checker: attempt.checker || null, checkerError: attempt.checkerError || null,
  }, null, 2));
  logMeta('experiment', { attempt: n, variant, kind: 'html', passed: attempt.passed, hard: attempt.hardFailures.map((f) => f.id).join(',') || '-', ms: llm.ms, tokens: tokensOf(llm.usage), run: run.id });
  return attempt;
}

// Loop: build prompt -> call model -> post-process -> check; stop at the first attempt that passes.
async function runExperiment(input, { signal, maxAttempts, variant, baseDir, slug, enableChecker } = {}) {
  const max = maxAttempts || envInt('MAX_ATTEMPTS', 3);
  const useVariant = variant || env('EXPERIMENT_PROMPT_VARIANT', 'vi');
  const useChecker = enableChecker === undefined ? envBool('ENABLE_CHECKER', true) : enableChecker;
  const attempts = [];
  let winner = null;

  for (let n = 1; n <= max; n++) {
    const a = await runExperimentAttempt(input, { n, variant: useVariant, signal, baseDir, slug, enableChecker: useChecker });
    attempts.push(a);
    if (a.kind === 'not_suitable') { winner = a; break; }
    if (a.kind === 'html' && a.passed) { winner = a; break; }
  }

  const lastRunId = attempts[attempts.length - 1].runId;
  const publicAttempts = attempts.map(({ html, raw, ...rest }) => rest);
  if (winner && winner.kind === 'not_suitable') return { ok: true, kind: 'not_suitable', reason: winner.reason, attempts: publicAttempts, runId: winner.runId, variant: useVariant };
  if (winner) return { ok: true, kind: 'html', html: winner.html, attempts: publicAttempts, runId: winner.runId, variant: useVariant };
  if (attempts.every((a) => a.kind === 'error')) {
    throw new LlmError(attempts[attempts.length - 1].error || 'Không gọi được model.', { kind: attempts[attempts.length - 1].errorKind });
  }
  return { ok: true, kind: 'unstable', attempts: publicAttempts, runId: lastRunId, variant: useVariant, lastHtml: attempts.filter((a) => a.html).pop().html };
}

module.exports = { runDescribe, runExperiment, runExperimentAttempt, lessonSlug };
