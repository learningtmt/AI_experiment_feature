'use strict';
// Subject whitelist: which subjects from list-subject are shown, and with which display name.
const fs = require('fs');
const path = require('path');
const { normalize } = require('./vn-text');

const WHITELIST_PATH = path.join(__dirname, '..', 'config', 'subjects-whitelist.json');

function loadWhitelist() {
  return JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf8'));
}

// "Sách điện tử môn Vật lí" -> "Vật lí" (prefix match is case-insensitive).
function stripPrefix(name, prefix) {
  const raw = String(name == null ? '' : name).normalize('NFC').trim();
  const p = String(prefix || '').normalize('NFC');
  if (p && raw.toLowerCase().startsWith(p.toLowerCase())) return raw.slice(p.length).trim();
  return raw;
}

// Exact (not substring) match on the normalized name, so "Lịch sử và Địa lí" and "Toán" do not match.
function isAllowedSubject(name, whitelist) {
  const cfg = whitelist || loadWhitelist();
  const key = normalize(stripPrefix(name, cfg.prefix));
  return cfg.allowed.map(normalize).includes(key);
}

// Returns { shown: [{id, name, raw}], excluded: [rawName] }.
function filterSubjects(subjects, whitelist) {
  const cfg = whitelist || loadWhitelist();
  const shown = [];
  const excluded = [];
  for (const s of subjects) {
    if (isAllowedSubject(s.name, cfg)) shown.push({ id: s._id, name: stripPrefix(s.name, cfg.prefix), raw: s });
    else excluded.push(s.name);
  }
  return { shown, excluded };
}

module.exports = { loadWhitelist, stripPrefix, isAllowedSubject, filterSubjects };
