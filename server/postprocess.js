'use strict';
// Cleaning of raw model output. Prompt 1 -> plain text, prompt 2 -> HTML document.

const NOT_SUITABLE_RE = /^[\s`"'“”‘’*_>#\-\[\]()]*KHONG_PHU_HOP\s*:/;

// Returns the reason when the text (after skipping whitespace and wrapper characters) starts with KHONG_PHU_HOP:
function detectNotSuitable(text) {
  const s = String(text == null ? '' : text);
  const m = NOT_SUITABLE_RE.exec(s);
  if (!m) return null;
  let reason = s.slice(m[0].length);
  reason = reason.replace(/```\s*$/, '').trim().replace(/[`"'“”‘’*_]+$/, '').trim();
  return reason;
}

function stripFences(text) {
  let s = String(text == null ? '' : text).trim();
  s = s.replace(/^```[A-Za-z0-9_-]*[ \t]*\r?\n?/, '');
  s = s.replace(/\r?\n?```[ \t]*$/, '');
  return s;
}

// ---- prompt 1 -----------------------------------------------------------------------------
// Removes fences and leading/trailing blank lines only. Content is never edited.
function cleanDescription(raw) {
  const unsuitable = detectNotSuitable(raw);
  if (unsuitable !== null) return { kind: 'not_suitable', reason: unsuitable, warnings: [] };
  const text = stripFences(raw).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
  return { kind: 'description', text, warnings: descriptionWarnings(text) };
}

function descriptionWarnings(text) {
  const w = [];
  if (/\$/.test(text)) w.push('Có ký hiệu $ (nghi LaTeX)');
  if (/\\/.test(text)) w.push('Có dấu \\ (nghi LaTeX)');
  if (/\*\*/.test(text)) w.push('Có ** (nghi markdown)');
  if (/^\s*#/m.test(text)) w.push('Có dòng bắt đầu bằng # (nghi markdown)');
  return w;
}

// ---- prompt 2 -----------------------------------------------------------------------------
function checkStructure(html) {
  const errors = [];
  if (!/<!doctype\s+html\s*>/i.test(html)) errors.push('Thiếu <!DOCTYPE html>');
  if (!/<\/html\s*>/i.test(html)) errors.push('Thiếu </html>');
  if (!/window\.gameReady\s*=\s*true/.test(html)) errors.push('Thiếu window.gameReady = true');
  return errors;
}

function cleanHtml(raw) {
  const unsuitable = detectNotSuitable(raw);
  if (unsuitable !== null) return { kind: 'not_suitable', reason: unsuitable };
  let s = stripFences(raw);
  const start = s.search(/<!doctype/i);
  if (start > 0) s = s.slice(start);
  const ends = [...s.matchAll(/<\/html\s*>/gi)];
  if (ends.length) {
    const last = ends[ends.length - 1];
    s = s.slice(0, last.index + last[0].length);
  }
  s = s.trim();
  return { kind: 'html', html: s, structureErrors: checkStructure(s) };
}

module.exports = { detectNotSuitable, stripFences, cleanDescription, descriptionWarnings, cleanHtml, checkStructure };
