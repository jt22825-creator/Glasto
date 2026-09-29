/*
 * Guards the project's deliberate limits: the userscript must only read the
 * ticket page, never act on it, and the build must be current.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build, OUT } = require('../scripts/build-userscript');

const ROOT = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'userscript/src/main.js'), 'utf8');
const built = fs.readFileSync(OUT, 'utf8');

test('built userscript is up to date with its sources', () => {
  assert.equal(built, build(), 'run `npm run build`');
});

test('userscript metadata block is valid and does not grant page-script access', () => {
  const header = built.slice(0, built.indexOf('// ==/UserScript==') + 20);
  assert.match(header, /@name\s+Ticket Queue Helper/);
  assert.match(header, /@noframes/);
  assert.doesNotMatch(header, /@grant\s+unsafeWindow/);
  assert.doesNotMatch(header, /@grant\s+none/);
});

test('userscript never clicks, submits, fills or dispatches events on the ticket page', () => {
  // Strip the helper's own shadow-DOM UI wiring before scanning.
  const forbidden = [
    [/\.click\(\)/, 'programmatic click'],
    [/\.submit\(\)/, 'form submit'],
    [/requestSubmit/, 'form submit'],
    [/dispatchEvent/, 'synthetic events'],
    [/document\.(querySelector|getElementById|getElementsBy)[^;]*\.(value|checked)\s*=/, 'filling page fields'],
    [/location\.(reload|replace|assign)|location\.href\s*=/, 'navigating the page'],
    [/window\.open\(/, 'opening sessions'],
    [/\bfetch\([^)]*location/, 'requests to the ticket site'],
    [/captcha/i, 'captcha handling'],
    [/navigator\.webdriver|userAgent\s*=/, 'automation disguise'],
  ];
  for (const [rx, what] of forbidden) assert.doesNotMatch(main, rx, `userscript must not do: ${what}`);
});

test('network calls go only to the dashboard and ntfy', () => {
  const urls = [...main.matchAll(/request\(\s*'(GET|POST)',\s*([^,]+),/g)].map((m) => m[2].trim());
  assert.ok(urls.length >= 1);
  for (const u of urls) assert.match(u, /dashboardUrl|r\.url/, `unexpected request target ${u}`);
});

test('no proxy/VPN rotation or session launching anywhere in the project code', () => {
  const files = ['server/server.js', 'server/store.js', 'dashboard/app.js', 'userscript/src/main.js', 'notifications/ntfy.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /child_process|puppeteer|playwright|selenium|socks|proxy-agent|HttpsProxyAgent/i, f);
  }
});
