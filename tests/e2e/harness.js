/*
 * E2E harness: starts the dashboard server and a fake ntfy server, and
 * injects the built userscript into mock pages with Tampermonkey-style GM_*
 * stubs. Everything runs against localhost mock pages only.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { createServer } = require('../../server/server');
const { startFakeNtfy } = require('../helpers/fake-ntfy');

const USERSCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'userscript', 'ticket-helper.user.js'), 'utf8');

async function startServers() {
  const ntfy = await startFakeNtfy();
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'th-e2e-')), 'state.json');
  const app = createServer({ dataFile, quiet: true });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return {
    app,
    ntfy,
    base,
    async close() {
      await app.shutdown();
      await ntfy.close();
    },
  };
}

// Runs in the page before any page script. Records what the helper does in
// localStorage so the record survives navigations within the mock origin.
function stubScript(settings) {
  return `(() => {
  const rec = (k, v) => { const a = JSON.parse(localStorage.getItem('rec:' + k) || '[]'); a.push(v); localStorage.setItem('rec:' + k, JSON.stringify(a)); };
  window.__rec = rec;
  if (!localStorage.getItem('__seeded')) {
    const s = ${JSON.stringify(settings || {})};
    for (const k of Object.keys(s)) localStorage.setItem('gm:' + k, JSON.stringify(s[k]));
    localStorage.setItem('__seeded', '1');
  }
  window.GM_getValue = (k, d) => { const v = localStorage.getItem('gm:' + k); return v == null ? d : JSON.parse(v); };
  window.GM_setValue = (k, v) => localStorage.setItem('gm:' + k, JSON.stringify(v));
  window.GM_notification = (o) => rec('notifications', { title: o.title, text: o.text });
  window.GM_setClipboard = (v) => rec('clipboard', v);
  window.GM_getTab = (cb) => cb(JSON.parse(sessionStorage.getItem('gm-tab') || '{}'));
  window.GM_saveTab = (t) => sessionStorage.setItem('gm-tab', JSON.stringify(t));
  window.GM_registerMenuCommand = () => {};
  window.GM_xmlhttpRequest = (o) => {
    rec('requests', { method: o.method, url: o.url });
    window.__gmXhr({ method: o.method, url: o.url, headers: o.headers, data: o.data })
      .then((r) => (r.error ? o.onerror && o.onerror(r) : o.onload && o.onload(r)));
  };
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
    createOscillator() {
      return { frequency: { value: 0 }, type: '', connect() {}, stop() {},
        start() { const n = Number(localStorage.getItem('rec:beeps') || 0) + 1; localStorage.setItem('rec:beeps', String(n)); } };
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
})();`;
}

async function newHelperContext(browser, settings) {
  const context = await browser.newContext();
  // GM_xmlhttpRequest is not subject to CORS; emulate that by sending from Node.
  await context.exposeFunction('__gmXhr', async (req) => {
    try {
      const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.data });
      return { status: res.status, responseText: await res.text() };
    } catch (e) {
      return { error: String(e) };
    }
  });
  await context.addInitScript(stubScript(settings));
  await context.addInitScript(`document.addEventListener('DOMContentLoaded', () => {\n${USERSCRIPT}\n});`);
  return context;
}

async function launch() {
  return chromium.launch();
}

const read = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), key);
const state = (page) => page.locator('ticket-helper-ui').getAttribute('data-state');

async function waitForState(page, s, timeout) {
  await page.waitForSelector(`ticket-helper-ui[data-state="${s}"]`, { state: 'attached', timeout: timeout || 10000 });
}

async function waitFor(fn, timeout, what) {
  const end = Date.now() + (timeout || 10000);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for ' + (what || 'condition'));
    await new Promise((r) => setTimeout(r, 100));
  }
}

module.exports = { startServers, newHelperContext, launch, read, state, waitForState, waitFor };
