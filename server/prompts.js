'use strict';
// Prompt assembly. Templates are read from prompts/ on every call (no cache) so they can be edited live.
// Only the documented {tokens} are replaced; everything else in the prompt (${...}, {…}, {}) is real content.
const fs = require('fs');
const path = require('path');
const { ROOT, env } = require('./env');

// PROMPTS_DIR lets tests point at a temp copy; the real prompt files are never written to.
const promptsDir = () => env('PROMPTS_DIR', path.join(ROOT, 'prompts'));

const FILES = {
  describe: 'mo_ta_thi_nghiem_v1.txt',
  experiment: { vi: 'thi_nghiem_html_v1.txt', en: 'thi_nghiem_html_v1_en.txt' },
};

const TOKENS = {
  describe: ['subject', 'class', 'explain', 'current', 'note'],
  experiment: ['subject', 'class', 'explain', 'experiment', 'note'],
};

// Single pass with a replacer function: values are inserted literally (no "$&" / "$1" expansion)
// and are never scanned again, so a teacher description containing "{class}" stays untouched.
function fill(template, tokens, values) {
  const re = new RegExp('\\{(' + tokens.join('|') + ')\\}', 'g');
  return template.replace(re, (_match, key) => {
    const v = values[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

function readTemplate(file) {
  return fs.readFileSync(path.join(promptsDir(), file), 'utf8');
}

function buildDescribePrompt(v) {
  return fill(readTemplate(FILES.describe), TOKENS.describe, v);
}

function experimentFile(variant) {
  const file = FILES.experiment[variant];
  if (!file) throw new Error('variant không hợp lệ: ' + variant + ' (vi | en)');
  return file;
}

function buildExperimentPrompt(v, variant) {
  return fill(readTemplate(experimentFile(variant || 'vi')), TOKENS.experiment, v);
}

module.exports = { fill, buildDescribePrompt, buildExperimentPrompt, TOKENS, FILES };
