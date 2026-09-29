#!/usr/bin/env node
/*
 * Group dashboard server. Zero dependencies.
 *
 * Serves the dashboard, the mock ticket pages and the userscript, and keeps
 * the group's session list. It talks only to group members' browsers and
 * (optionally) to the group's ntfy topic. It never contacts the ticket site.
 *
 * Environment:
 *   PORT        default 8787
 *   HOST        default 0.0.0.0 (reachable from other devices on your network)
 *   GROUP_KEY   optional shared passphrase required for all /api calls
 *   DATA_FILE   default data/state.json
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { GroupStore, describe } = require('./store');
const C = require('../shared/countdown');
const N = require('../notifications/ntfy');

const ROOT = path.join(__dirname, '..');
const STATIC = {
  '/': 'dashboard',
  '/shared/': 'shared',
  '/notifications/': 'notifications',
  '/mock/': 'mock',
  '/userscript/': 'userscript',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};

function createServer(opts) {
  const o = opts || {};
  const groupKey = o.groupKey || '';
  const now = o.now || Date.now;
  const sendNtfy = o.sendNtfy || ((cfg, notification) => N.send(cfg, notification));
  const clients = new Set();
  let broadcastTimer = null;

  const store = new GroupStore({
    file: o.dataFile === undefined ? path.join(ROOT, 'data', 'state.json') : o.dataFile,
    now,
    onChange: () => scheduleBroadcast(),
    onBooking: (session) => notifyBooking(session),
  }).load();

  function log(...args) {
    if (!o.quiet) console.log(new Date(now()).toISOString(), ...args);
  }

  function ntfyConfig() {
    const n = store.state.config.ntfy;
    return n.enabled && N.isValidTopic(n.topic) ? n : null;
  }

  async function pushGroup(notification, what) {
    const cfg = ntfyConfig();
    if (!cfg) return { sent: false, reason: 'ntfy not enabled' };
    try {
      await sendNtfy(cfg, notification);
      store.event('notified', `Group notified: ${notification.title}`);
      store.changed();
      log('ntfy sent:', what);
      return { sent: true };
    } catch (e) {
      store.event('notify_failed', `ntfy failed (${what}): ${e.message}`);
      store.changed();
      log('ntfy failed:', e.message);
      return { sent: false, reason: e.message };
    }
  }

  function notifyBooking(session) {
    const c = store.state.config;
    log('BOOKING:', describe(session));
    broadcast({ type: 'booking', session });
    return pushGroup(
      N.bookingNotification({
        member: session.member,
        device: session.device,
        connection: session.connection,
        vpn: session.vpn,
        sessionId: session.id,
        at: session.bookingDetectedAt || now(),
        timezone: c.timezone,
        dashboardUrl: c.dashboardUrl || undefined,
      }),
      'booking ' + session.id
    );
  }

  function checkSaleAlerts() {
    const c = store.state.config;
    if (!c.notifySaleAlerts || !ntfyConfig()) return;
    const { sales } = C.parseSalesConfig(c.salesText, { timezone: c.timezone, now: now() });
    for (const a of C.dueAlerts(sales, now(), store.state.firedAlerts)) {
      store.state.firedAlerts[a.id] = now();
      pushGroup(N.saleAlertNotification(a, { timezone: c.timezone, dashboardUrl: c.dashboardUrl }), a.id);
    }
  }

  // ------------------------------------------------------------ live updates (SSE)

  function broadcast(msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const res of clients) res.write(data);
  }

  function scheduleBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      broadcast({ type: 'state', state: store.snapshot() });
    }, 100);
  }

  // ------------------------------------------------------------ HTTP

  function send(res, status, body, headers) {
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(status, Object.assign({ 'Content-Type': isJson ? TYPES['.json'] : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
    res.end(isJson ? JSON.stringify(body) : body);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          reject(Object.assign(new Error('body too large'), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (_) {
          reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function serveStatic(req, res, pathname) {
    const prefix = Object.keys(STATIC)
      .filter((p) => pathname.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    if (!prefix) return send(res, 404, 'not found');
    const baseDir = path.join(ROOT, STATIC[prefix]);
    let rel = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(baseDir, rel));
    if (!file.startsWith(baseDir + path.sep)) return send(res, 403, 'forbidden');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found');
      send(res, 200, buf, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    });
  }

  async function handleApi(req, res, url) {
    const key = req.headers['x-group-key'] || url.searchParams.get('key') || '';
    if (groupKey && key !== groupKey) return send(res, 401, { error: 'group key required' });

    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    const m = req.method;

    if (m === 'GET' && parts[1] === 'state') return send(res, 200, store.snapshot());

    if (m === 'GET' && parts[1] === 'events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'state', state: store.snapshot() })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }

    if (parts[1] === 'sessions') {
      const id = parts[2];
      if (m === 'POST' && !id) return send(res, 201, store.register(await readJson(req)));
      if (m === 'POST' && parts[3] === 'heartbeat') {
        const session = store.heartbeat(id, await readJson(req));
        const c = store.state.config;
        return send(res, 200, { session, config: { groupName: c.groupName, salesText: c.salesText, timezone: c.timezone } });
      }
      if (m === 'POST' && parts[3] === 'reset') return send(res, 200, store.reset(id));
      if (m === 'PATCH' && id) return send(res, 200, store.update(id, await readJson(req)));
      if (m === 'DELETE' && id) {
        store.remove(id);
        return send(res, 200, { ok: true });
      }
    }

    if (parts[1] === 'config' && m === 'PUT') return send(res, 200, store.setConfig(await readJson(req)));

    if (parts[1] === 'notify' && parts[2] === 'test' && m === 'POST') {
      const body = await readJson(req);
      const c = store.state.config;
      const r = await pushGroup(N.testNotification({ member: body.member, dashboardUrl: c.dashboardUrl || undefined }), 'test');
      return send(res, r.sent ? 200 : 502, r);
    }

    return send(res, 404, { error: 'unknown endpoint' });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Group-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.message });
      if (!e.status) log('error:', e.stack);
      return undefined;
    }
  });

  const timers = [
    setInterval(checkSaleAlerts, 1000),
    setInterval(() => store.sweep(), 5000),
    setInterval(() => broadcast({ type: 'ping', serverTime: now() }), 15000),
  ];
  /** Stop timers, end live-update streams and close the server. */
  function shutdown() {
    timers.forEach(clearInterval);
    clearTimeout(broadcastTimer);
    for (const c of clients) c.end();
    clients.clear();
    store.saveNow();
    return new Promise((resolve) => {
      server.close(() => resolve());
      if (server.closeAllConnections) server.closeAllConnections();
    });
  }

  return { server, store, shutdown, checkSaleAlerts, notifyBooking };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  const { server, shutdown } = createServer({
    groupKey: process.env.GROUP_KEY || '',
    dataFile: process.env.DATA_FILE || path.join(ROOT, 'data', 'state.json'),
  });
  server.listen(port, host, () => {
    const os = require('os');
    const addrs = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${port}/`);
    console.log(`Ticket helper dashboard running.`);
    console.log(`  This computer:   http://localhost:${port}/`);
    for (const a of addrs) console.log(`  On your network: ${a}`);
    console.log(`  Mock pages:      http://localhost:${port}/mock/`);
    console.log(`  Userscript:      http://localhost:${port}/userscript/ticket-helper.user.js`);
    console.log(process.env.GROUP_KEY ? '  Group key:       required' : '  Group key:       none (set GROUP_KEY to require one)');
  });
  const stop = () => shutdown().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { createServer };
