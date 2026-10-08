'use strict';
// English-leak detectors for visible UI text (used by the checker: H6 hard, S1 soft).
const fs = require('fs');
const path = require('path');

const STOPLIST_PATH = path.join(__dirname, '..', 'config', 'english-stoplist.json');

function loadStoplist() {
  return JSON.parse(fs.readFileSync(STOPLIST_PATH, 'utf8'));
}

// Split on anything that is not a letter, combining mark or digit (subscripts count as digits).
function tokenize(text) {
  return String(text == null ? '' : text)
    .normalize('NFC')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

function hasDigitOrSubscript(token) {
  return /\p{N}/u.test(token);
}

function buildElementRegex(elements) {
  const alt = [...elements].sort((a, b) => b.length - a.length).join('|');
  return new RegExp('^(?:' + alt + ')+$');
}

// "NaCl", "HCl", "NO", "CO" look like formulas; "Back", "Show", "Close" (one capital) do not.
function isFormulaLike(token, elementRegex) {
  if (!elementRegex.test(token)) return false;
  if (token === token.toUpperCase()) return true;
  const capitals = (token.match(/\p{Lu}/gu) || []).length;
  return capitals >= 2;
}

// H6: whole-token match against the English stop list.
function findStoplistHits(text, list) {
  const cfg = list || loadStoplist();
  const words = new Set(cfg.words.map((w) => w.toLowerCase()));
  const always = new Set((cfg.alwaysFlag || []).map((w) => w.toLowerCase()));
  const ignore = new Set([...(cfg.ignoreUnits || []), ...(cfg.ignoreElements || [])]);
  const elementRegex = buildElementRegex(cfg.ignoreElements || []);
  const hits = new Map();
  for (const token of tokenize(text)) {
    if (hasDigitOrSubscript(token)) continue;
    if (ignore.has(token)) continue;
    const lower = token.toLowerCase();
    if (!words.has(lower)) continue;
    if (!always.has(lower) && isFormulaLike(token, elementRegex)) continue;
    hits.set(lower, (hits.get(lower) || 0) + 1);
  }
  return [...hits].map(([word, count]) => ({ word, count }));
}

// Vietnamese syllable without diacritics: [onset] nucleus [coda]. Used only to avoid flagging
// toneless Vietnamese words (nhanh, thanh, trong...) as English in the soft check S1.
const VN_ONSET = '(?:ngh|ng|nh|gh|gi|kh|ph|th|tr|ch|qu|[bcdghklmnpqrstvx])?';
const VN_NUCLEUS =
  '(?:ieu|oai|oay|uai|uay|uoi|uya|uye|uyu|yeu|ai|ao|au|ay|eo|eu|ia|ie|iu|oa|oe|oi|ua|ue|ui|uo|uy|ya|ye|a|e|i|o|u|y)';
const VN_CODA = '(?:ch|ng|nh|c|m|n|p|t)?';
const VN_SYLLABLE = new RegExp('^' + VN_ONSET + VN_NUCLEUS + VN_CODA + '$');

function looksVietnameseSyllable(lowerAscii) {
  return VN_SYLLABLE.test(lowerAscii);
}

// S1: pure-ASCII words of 4+ letters that are not formulas, symbols, units or toneless Vietnamese.
function findSuspectEnglish(text, list) {
  const cfg = list || loadStoplist();
  const ignore = new Set([...(cfg.ignoreUnits || []), ...(cfg.ignoreElements || [])]);
  const elementRegex = buildElementRegex(cfg.ignoreElements || []);
  const found = new Set();
  for (const token of tokenize(text)) {
    if (!/^[A-Za-z]{4,}$/.test(token)) continue;
    if (ignore.has(token)) continue;
    if (isFormulaLike(token, elementRegex)) continue;
    // All-caps acronyms (NADPH, ATP) are not words; H6 still catches STOP/RESET via the stop list.
    if (token === token.toUpperCase()) continue;
    if (looksVietnameseSyllable(token.toLowerCase())) continue;
    found.add(token);
  }
  return [...found];
}

module.exports = { loadStoplist, tokenize, findStoplistHits, findSuspectEnglish, looksVietnameseSyllable };
