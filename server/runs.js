'use strict';
// Per-model-call run folders: runs/<ISO-time>_<describe|experiment>_<slug>/
const fs = require('fs');
const path = require('path');
const { ROOT, env } = require('./env');
const { slugify } = require('./vn-text');

function runsRoot() {
  return env('RUNS_DIR', path.join(ROOT, 'runs'));
}

function createRun({ kind, slug, baseDir }) {
  const base = baseDir || runsRoot();
  fs.mkdirSync(base, { recursive: true });
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const stem = iso + '_' + kind + '_' + slugify(slug || 'run');
  let id = stem;
  for (let n = 2; fs.existsSync(path.join(base, id)); n++) id = stem + '_' + n;
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

function writeFile(dir, name, content) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

module.exports = { runsRoot, createRun, writeFile };
