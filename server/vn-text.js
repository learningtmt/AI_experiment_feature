'use strict';
// Vietnamese text helpers shared by the server (require) and the browser (window.VnText).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VnText = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Lowercase, strip diacritics, "đ" -> "d", collapse whitespace.
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ASCII slug for file and folder names.
  function slugify(s, maxLen) {
    const slug = normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug.slice(0, maxLen || 60).replace(/-+$/g, '') || 'khong-ten';
  }

  return { normalize, slugify };
});
