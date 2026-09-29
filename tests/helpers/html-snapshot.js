/*
 * Minimal, dependency-free page snapshot for unit tests: visible text from an
 * HTML string, plus a `has()` that understands the selector forms the default
 * detection config uses (#id, tag[attr*="v" i], [attr="v"]). The e2e tests
 * run the real detection against the same pages in Chromium.
 */
'use strict';
const fs = require('fs');
const path = require('path');

function textOf(html) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function tags(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map((m) => {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-z-]+)\s*=\s*"([^"]*)"/gi)) attrs[a[1].toLowerCase()] = a[2];
    return { tag: m[1].toLowerCase(), attrs };
  });
}

function matches(t, selector) {
  let m = /^#([\w-]+)$/.exec(selector);
  if (m) return t.attrs.id === m[1];
  m = /^([a-z]*)\[([\w-]+)(\*?=)"([^"]*)"( i)?\]$/i.exec(selector);
  if (!m) throw new Error('unsupported selector in test helper: ' + selector);
  const [, tag, attr, op, val, ci] = m;
  if (tag && t.tag !== tag.toLowerCase()) return false;
  let v = t.attrs[attr.toLowerCase()];
  if (v == null) return false;
  let want = val;
  if (ci) {
    v = v.toLowerCase();
    want = want.toLowerCase();
  }
  return op === '=' ? v === want : v.includes(want);
}

function snapshotFromHtml(html, url) {
  const all = tags(html);
  return { text: textOf(html), url: url || '', has: (sel) => all.some((t) => matches(t, sel)) };
}

function mockSnapshot(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'mock', file), 'utf8');
  return snapshotFromHtml(html, 'http://localhost/mock/' + file);
}

module.exports = { snapshotFromHtml, mockSnapshot, textOf };
