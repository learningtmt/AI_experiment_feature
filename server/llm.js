'use strict';
// Model access. Uses the API recorded in config/app.json by scripts/smoke-test.js (chat | responses).
// LLM_MOCK=1 returns fixed output instead of calling any model.
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { ROOT, env, envBool, envInt, redact } = require('./env');
const { MOCK_HTML } = require('./mock-html');

const NOT_SUITABLE_MARKER = 'KHONG_PHU_HOP_TEST';

const MOCK_DESCRIPTION = [
  'Tên thí nghiệm: Thí nghiệm thử',
  '',
  'Mục tiêu kiến thức: Quan sát sự thay đổi màu của dung dịch khi đổi nồng độ.',
  '',
  'Dụng cụ, hoá chất, vật liệu: Một ống nghiệm chứa dung dịch X nồng độ 1 mol/L.',
  '',
  'Các bước thực hiện:',
  '1. Chọn nồng độ.',
  '2. Bấm "Bắt đầu".',
  '',
  'Hiện tượng và kết quả: Dung dịch đổi màu đậm dần khi nồng độ tăng.',
  '',
  'Đại lượng thay đổi được: Nồng độ từ 1 mol/L đến 5 mol/L, bước 1 mol/L.',
].join('\n');

const MOCK_NOT_SUITABLE = 'KHONG_PHU_HOP: Bài này không có thí nghiệm mô phỏng được.';

class LlmError extends Error {
  constructor(message, { kind, status, code } = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind || 'api'; // api | timeout | aborted | config
    this.status = status;
    this.code = code;
  }
}

function appConfig() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'app.json'), 'utf8'));
}

function mockResult(prompt, kind) {
  const unsuitable = prompt.includes(NOT_SUITABLE_MARKER);
  let text;
  if (unsuitable) text = MOCK_NOT_SUITABLE;
  else text = kind === 'describe' ? MOCK_DESCRIPTION : MOCK_HTML;
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(text.length / 4);
  return {
    text,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
    ms: 5,
    model: 'mock',
    api: 'mock',
    mock: true,
  };
}

function normalizeUsage(u) {
  if (!u) return null;
  const prompt = u.prompt_tokens ?? u.input_tokens ?? null;
  const completion = u.completion_tokens ?? u.output_tokens ?? null;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: u.total_tokens ?? (prompt != null && completion != null ? prompt + completion : null) };
}

function toLlmError(err, signal) {
  if (err instanceof LlmError) return err;
  if (signal && signal.aborted) return new LlmError('Yêu cầu đã bị huỷ.', { kind: 'aborted' });
  const name = err && err.name;
  if (name === 'APIUserAbortError') return new LlmError('Yêu cầu đã bị huỷ.', { kind: 'aborted' });
  if (name === 'APIConnectionTimeoutError') return new LlmError('Model không trả lời kịp thời gian cho phép.', { kind: 'timeout' });
  const status = err && err.status;
  const msg = redact((err && err.message) || String(err));
  return new LlmError(status ? 'Lỗi API (' + status + '): ' + msg.slice(0, 300) : 'Lỗi kết nối: ' + msg.slice(0, 300), { kind: 'api', status, code: err && err.code });
}

function isRetryable(err) {
  if (err.kind === 'aborted' || err.kind === 'timeout' || err.kind === 'config') return false;
  if (err.status) return [408, 409, 429, 500, 502, 503, 504].includes(err.status);
  return true; // connection-level failure
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new LlmError('Yêu cầu đã bị huỷ.', { kind: 'aborted' }));
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(t); reject(new LlmError('Yêu cầu đã bị huỷ.', { kind: 'aborted' })); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function callOnce(client, model, api, prompt, signal, timeout) {
  const started = Date.now();
  if (api === 'responses') {
    const body = { model, input: prompt };
    if (env('TEMPERATURE')) body.temperature = Number(env('TEMPERATURE'));
    if (env('MAX_OUTPUT_TOKENS')) body.max_output_tokens = Number(env('MAX_OUTPUT_TOKENS'));
    const res = await client.responses.create(body, { signal, timeout, maxRetries: 0 });
    return { text: res.output_text || '', usage: normalizeUsage(res.usage), ms: Date.now() - started, finishReason: res.status };
  }
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  if (env('TEMPERATURE')) body.temperature = Number(env('TEMPERATURE'));
  if (env('MAX_OUTPUT_TOKENS')) body.max_completion_tokens = Number(env('MAX_OUTPUT_TOKENS'));
  const res = await client.chat.completions.create(body, { signal, timeout, maxRetries: 0 });
  const choice = res.choices && res.choices[0];
  return { text: (choice && choice.message && choice.message.content) || '', usage: normalizeUsage(res.usage), ms: Date.now() - started, finishReason: choice && choice.finish_reason };
}

// generate(prompt, { kind: 'describe' | 'experiment', signal }) -> { text, usage, ms, model, api, mock, finishReason }
async function generate(prompt, { kind, signal } = {}) {
  if (envBool('LLM_MOCK', false)) return mockResult(prompt, kind);

  if (!process.env.OPENAI_API_KEY) throw new LlmError('Chưa có OPENAI_API_KEY trong .env.', { kind: 'config' });
  const cfg = appConfig();
  const model = env('MODEL_ID', 'gpt-6-luna');
  const timeout = envInt('REQUEST_TIMEOUT_MS', 240000);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: env('OPENAI_BASE_URL', undefined), maxRetries: 0 });

  const delays = [3000, 8000]; // transport retries (429 / 5xx / connection); not counted as attempts
  const retries = [];
  const wallStarted = Date.now();
  for (let i = 0; ; i++) {
    const tryStarted = Date.now();
    try {
      const r = await callOnce(client, model, cfg.llmApi || 'chat', prompt, signal, timeout);
      return { ...r, model, api: cfg.llmApi || 'chat', mock: false, retries, wallMs: Date.now() - wallStarted };
    } catch (raw) {
      const err = toLlmError(raw, signal);
      if (i >= delays.length || !isRetryable(err)) throw err;
      const info = { status: err.status || null, kind: err.kind, ms: Date.now() - tryStarted, message: err.message.slice(0, 160) };
      retries.push(info);
      console.log('[llm] retry ' + (i + 1) + ' after ' + (info.status || info.kind) + ' (failed call took ' + info.ms + ' ms)');
      await sleep(delays[i], signal);
    }
  }
}

module.exports = { generate, LlmError, NOT_SUITABLE_MARKER };
