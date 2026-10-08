'use strict';
// Flatten the node-knowledge tree into a list of lessons (leaf nodes) with their ancestor chain.

// roots: children of the root node (data[0].childData). Depth is not assumed to be 3.
function flattenLessons(roots) {
  const out = [];
  (function walk(nodes, ancestors) {
    for (const n of nodes || []) {
      if (!n) continue;
      if (n.isLeaf === true) {
        const chain = ancestors.concat(n.name);
        out.push({ id: n.id, name: n.name, path: chain, group: ancestors.join(' › ') });
      } else if (Array.isArray(n.childData) && n.childData.length) {
        walk(n.childData, ancestors.concat(n.name));
      }
    }
  })(roots, []);
  return out;
}

// Full API response -> flat list. The root node (data[0]) itself is dropped; empty data -> [].
function lessonsFromResponse(resp) {
  if (!resp || resp.success === false) throw new Error('node-knowledge trả về lỗi');
  const root = Array.isArray(resp.data) ? resp.data[0] : null;
  return root ? flattenLessons(root.childData) : [];
}

// {explain} value for the prompts: ancestors and lesson name joined by " > ".
function explainOf(lesson) {
  return lesson.path.join(' > ');
}

module.exports = { flattenLessons, lessonsFromResponse, explainOf };
