'use strict';
// Data layer for subjects / book groups / lesson tree.
// "mock" reads fixtures/ (sample data, not checked against the textbook).
// "real" is a stub: the Edmicro API cannot be called from local yet.
const fs = require('fs');
const path = require('path');
const { ROOT, env } = require('./env');

const FIXTURES = path.join(ROOT, 'fixtures');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error('Giá trị ' + label + ' không hợp lệ');
  }
  return value;
}

// ---- mock -----------------------------------------------------------------------------
const mockProvider = {
  name: 'mock',

  // GET /api/ai-prompt/list-subject
  async getSubjects() {
    return readJson(path.join(FIXTURES, 'list-subject.json'));
  },

  // GET /api/book-group-ai?subjectCode=...
  async getBookGroups(subjectCode) {
    const all = readJson(path.join(FIXTURES, 'book-group-ai.json'));
    return all[safeId(subjectCode, 'subjectCode')] || [];
  },

  // POST /api/node-knowledge  { subjectCode, bookGroupCode, gradeCodes }
  async getNodeKnowledge({ subjectCode, bookGroupCode, gradeCodes }) {
    const grade = Array.isArray(gradeCodes) ? gradeCodes[0] : gradeCodes;
    const name = [subjectCode, bookGroupCode, grade].map((v, i) => safeId(v, ['subjectCode', 'bookGroupCode', 'gradeCodes'][i])).join('_');
    const file = path.join(FIXTURES, 'node-knowledge', name + '.json');
    if (!fs.existsSync(file)) return { success: true, data: [] };
    return readJson(file);
  },
};

// ---- real (stub) ----------------------------------------------------------------------
function notImplemented(what) {
  // TODO(Edmicro dev): implement with fetch().
  //   Base URL : <EDMICRO_API_BASE_URL>   (not known yet)
  //   Auth     : <header name + token>    (not known yet; read it from an env var, never hard-code)
  //   Endpoints: GET  /api/ai-prompt/list-subject
  //              GET  /api/book-group-ai?subjectCode=...
  //              POST /api/node-knowledge  { subjectCode, bookGroupCode, gradeCodes }
  throw new Error('Provider "real" chưa được cài đặt (' + what + '). Xem TODO trong server/data-provider.js.');
}

const realProvider = {
  name: 'real',
  async getSubjects() { return notImplemented('getSubjects'); },
  async getBookGroups() { return notImplemented('getBookGroups'); },
  async getNodeKnowledge() { return notImplemented('getNodeKnowledge'); },
};

function getProvider(name) {
  const which = (name || env('DATA_PROVIDER', 'mock')).toLowerCase();
  if (which === 'mock') return mockProvider;
  if (which === 'real') return realProvider;
  throw new Error('DATA_PROVIDER không hợp lệ: ' + which + ' (mock | real)');
}

module.exports = { getProvider, mockProvider, realProvider };
