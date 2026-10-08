'use strict';
// Smoke test: calls MODEL_ID with a short question, tries chat.completions first and
// falls back to the Responses API. On success writes the working API to config/app.json.
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { ROOT, env, envInt, redact } = require('../server/env');

const CONFIG_PATH = path.join(ROOT, 'config', 'app.json');
const PROMPT = 'Trả lời bằng đúng một câu tiếng Việt ngắn: 2 + 3 bằng mấy?';

function hostOf(url) {
  try { return new URL(url).host; } catch { return '(mặc định của gói openai)'; }
}

function describeError(err) {
  return {
    status: err && err.status,
    code: err && err.code,
    type: err && err.type,
    message: redact(err && err.message),
  };
}

async function viaChat(client, model) {
  const body = { model, messages: [{ role: 'user', content: PROMPT }] };
  if (env('TEMPERATURE')) body.temperature = Number(env('TEMPERATURE'));
  if (env('MAX_OUTPUT_TOKENS')) body.max_completion_tokens = Number(env('MAX_OUTPUT_TOKENS'));
  const res = await client.chat.completions.create(body);
  return { text: res.choices && res.choices[0] && res.choices[0].message.content, usage: res.usage };
}

async function viaResponses(client, model) {
  const body = { model, input: PROMPT };
  if (env('TEMPERATURE')) body.temperature = Number(env('TEMPERATURE'));
  if (env('MAX_OUTPUT_TOKENS')) body.max_output_tokens = Number(env('MAX_OUTPUT_TOKENS'));
  const res = await client.responses.create(body);
  return { text: res.output_text, usage: res.usage };
}

function saveApi(api, model) {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.llmApi = api;
  cfg.llmApiVerifiedWithModel = model;
  cfg.llmApiVerifiedAt = new Date().toISOString();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

async function main() {
  const model = env('MODEL_ID', 'gpt-6-luna');
  const baseURL = env('OPENAI_BASE_URL', undefined);
  console.log('Model          :', model);
  console.log('Endpoint host  :', hostOf(baseURL));
  console.log('Có OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'có' : 'KHÔNG');
  if (!process.env.OPENAI_API_KEY) {
    console.log('\nKết quả: THẤT BẠI - chưa có OPENAI_API_KEY (đặt trong .env).');
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL, timeout: envInt('REQUEST_TIMEOUT_MS', 240000), maxRetries: 0 });

  const attempts = [];
  for (const [api, fn] of [['chat', viaChat], ['responses', viaResponses]]) {
    const started = Date.now();
    try {
      const r = await fn(client, model);
      const ms = Date.now() - started;
      attempts.push({ api, ok: true, ms });
      console.log(`\n[${api}] THÀNH CÔNG sau ${ms} ms`);
      console.log('Nội dung trả về:', JSON.stringify(r.text));
      console.log('usage          :', JSON.stringify(r.usage));
      saveApi(api, model);
      console.log(`\nKết quả: THÀNH CÔNG. API dùng được: "${api}" (đã ghi vào config/app.json)`);
      return;
    } catch (err) {
      const e = describeError(err);
      attempts.push({ api, ok: false, ...e });
      console.log(`\n[${api}] LỖI:`, JSON.stringify(e));
      // Only fall back when the API itself looks unsupported; auth/network errors will not be fixed by switching.
      const unsupported = [400, 404, 405, 501].includes(e.status);
      if (api === 'chat' && !unsupported) break;
    }
  }
  console.log('\nKết quả: THẤT BẠI. Chi tiết các lần thử:');
  console.log(JSON.stringify(attempts, null, 2));
  process.exit(1);
}

main().catch((e) => { console.error('Lỗi không mong đợi:', redact(e && e.stack || e)); process.exit(1); });
