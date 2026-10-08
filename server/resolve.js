'use strict';
// Pure decision functions shared by the server (require) and the browser (window.Resolve).
// A = "Mô tả của thầy cô" (teacherDescription), B = "Mô tả AI" (aiDescription).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Resolve = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function trim(v) {
    return String(v == null ? '' : v).trim();
  }

  // At least one of the two boxes has real content (whitespace-only counts as empty).
  function hasDescription(a, b) {
    return trim(a) !== '' || trim(b) !== '';
  }

  // Source of prompt 2: box B wins when it has content, otherwise box A.
  function effectiveDescription(a, b) {
    return trim(b) !== '' ? b : a;
  }

  // Source of prompt 1: always box A, never box B.
  function aiInput(a) {
    return a;
  }

  return { hasDescription, effectiveDescription, aiInput };
});
