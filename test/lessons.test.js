'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { flattenLessons, lessonsFromResponse, explainOf } = require('../server/lessons');
const { getProvider } = require('../server/data-provider');
const { filterSubjects } = require('../server/subjects');

const leaf = (id, name) => ({ id, name, isLeaf: true, childData: [] });
const node = (id, name, kids) => ({ id, name, isLeaf: false, childData: kids });

test('lessons: ancestor chain and group label for a 3-level tree', () => {
  const roots = [node('p1', 'Phần 1', [node('c1', 'Chương 1', [leaf('b1', 'Bài 1'), leaf('b2', 'Bài 2')])])];
  const out = flattenLessons(roots);
  assert.deepEqual(out.map((l) => l.id), ['b1', 'b2']);
  assert.deepEqual(out[0].path, ['Phần 1', 'Chương 1', 'Bài 1']);
  assert.equal(out[0].group, 'Phần 1 › Chương 1');
  assert.equal(explainOf(out[0]), 'Phần 1 > Chương 1 > Bài 1');
});

test('lessons: only isLeaf:true nodes become lessons', () => {
  const roots = [node('c1', 'Chương 1', [leaf('b1', 'Bài 1'), node('x', 'Mục rỗng', []), node('s', 'Nhóm', [leaf('b2', 'Bài 2')])])];
  assert.deepEqual(flattenLessons(roots).map((l) => l.id), ['b1', 'b2']);
});

test('lessons: tolerates trees that are not 3 levels deep', () => {
  const two = flattenLessons([node('c', 'Chương', [leaf('b', 'Bài')])]);
  assert.deepEqual(two[0].path, ['Chương', 'Bài']);
  assert.equal(two[0].group, 'Chương');
  const one = flattenLessons([leaf('b', 'Bài lẻ')]);
  assert.deepEqual(one[0].path, ['Bài lẻ']);
  assert.equal(one[0].group, '');
  const four = flattenLessons([node('a', 'A', [node('b', 'B', [node('c', 'C', [leaf('d', 'D')])])])]);
  assert.equal(four[0].group, 'A › B › C');
  assert.deepEqual(flattenLessons([]), []);
  assert.deepEqual(flattenLessons(undefined), []);
});

test('lessons: the root node is dropped; empty data gives an empty list', () => {
  const resp = { success: true, data: [node('root', 'Sinh học 11', [node('c', 'Chương', [leaf('b', 'Bài')])])] };
  assert.deepEqual(lessonsFromResponse(resp)[0].path, ['Chương', 'Bài']);
  assert.deepEqual(lessonsFromResponse({ success: true, data: [] }), []);
  assert.throws(() => lessonsFromResponse({ success: false }));
});

test('fixtures: every tree has >= 2 groups and >= 3 lessons; empty combinations return data: []', async () => {
  const dir = path.join(__dirname, '..', 'fixtures', 'node-knowledge');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 11);
  for (const f of files) {
    const resp = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const lessons = lessonsFromResponse(resp);
    assert.ok(lessons.length >= 3, f + ' needs >= 3 lessons');
    assert.ok(new Set(lessons.map((l) => l.group)).size >= 2, f + ' needs >= 2 groups');
  }
  const empty = await getProvider('mock').getNodeKnowledge({ subjectCode: 'SDT_KHTN', bookGroupCode: 'KNTT', gradeCodes: ['C6'] });
  assert.deepEqual(empty, { success: true, data: [] });
});

test('fixtures: every lesson named in eval/cases.json exists (exact names)', async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'cases.json'), 'utf8'));
  const provider = getProvider('mock');
  const { shown } = filterSubjects(await provider.getSubjects());
  for (const c of cases) {
    const subject = shown.find((s) => s.name === c.subject);
    assert.ok(subject, 'subject not found for ' + c.id + ': ' + c.subject);
    const grade = 'C' + c.class.replace(/\D/g, '');
    const resp = await provider.getNodeKnowledge({ subjectCode: subject.id, bookGroupCode: 'KNTT', gradeCodes: [grade] });
    const found = lessonsFromResponse(resp).some((l) => explainOf(l) === c.explain);
    assert.ok(found, 'lesson missing in fixtures for ' + c.id + ': ' + c.explain);
  }
});

test('fixtures: book groups have KNTT and CTST with the right grades', async () => {
  const provider = getProvider('mock');
  const grades = async (code) => (await provider.getBookGroups(code)).find((g) => g.id === 'KNTT').itemClasses.map((c) => c.id);
  assert.deepEqual(await grades('SDT_SINHHOC'), ['C10', 'C11', 'C12']);
  assert.deepEqual(await grades('SDT_KHTN'), ['C6', 'C7', 'C8', 'C9']);
  const ids = (await provider.getBookGroups('SDT_VATLI')).map((g) => g.id);
  assert.deepEqual(ids, ['KNTT', 'CTST']);
});
