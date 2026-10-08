'use strict';
// Loads .env (variables already set in the real environment win over .env) and exposes helpers.
const path = require('path');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

function env(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  // Strip inline "# comment" that .env.example uses, and surrounding whitespace.
  const cleaned = String(v).replace(/\s+#.*$/, '').trim();
  return cleaned === '' ? fallback : cleaned;
}

function envBool(name, fallback) {
  const v = env(name, undefined);
  if (v === undefined) return fallback;
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase());
}

function envInt(name, fallback) {
  const v = parseInt(env(name, ''), 10);
  return Number.isFinite(v) ? v : fallback;
}

// Remove the API key (and anything that looks like a key) from text before it is printed.
function redact(text) {
  let s = String(text == null ? '' : text);
  const key = process.env.OPENAI_API_KEY;
  if (key && key.length > 6) s = s.split(key).join('[REDACTED]');
  // Also mask key-looking tokens (full or already server-masked, e.g. "sk-...", "key_AbCd****WxYz").
  return s.replace(/\b(?:sk|key|pk)[-_][A-Za-z0-9*_\-]{6,}/g, '[REDACTED]');
}

module.exports = { ROOT, env, envBool, envInt, redact };
