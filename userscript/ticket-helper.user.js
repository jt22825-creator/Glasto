// ==UserScript==
// @name         Ticket Queue Helper
// @namespace    https://github.com/jt22825-creator/glasto
// @version      2.0.0
// @description  Watches the ticket tab YOU opened: shows queue state, alarms when the booking page appears, blocks accidental refreshes while queued, reports to your group dashboard, and keeps checkout details one click away. Never clicks, fills or submits anything on the ticket site.
// @match        *://*.seetickets.com/*
// @match        *://*.queue-it.net/*
// @include      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/mock\/.*$/
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getTab
// @grant        GM_saveTab
// @grant        GM_registerMenuCommand
// @connect      ntfy.sh
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==
//
// GENERATED FILE — edit userscript/src/ and shared/, then run `npm run build`.

(function () {
'use strict';

// ---- shared/detection.js ----
const TicketHelperDetection = (function () {
const module = { exports: {} };
/*
 * Page-state detection for the ticket helper.
 *
 * Pure logic: takes a snapshot of the page (text, URL, and a function that
 * says whether a CSS selector matches) and decides which of four states the
 * tab is in. It never interacts with the page.
 *
 * Shared by the userscript (inlined at build time), the mock test runner
 * (loaded as a browser global) and the Node unit tests (require()).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperDetection = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATES = Object.freeze({
    WAITING: 'waiting',
    IN_QUEUE: 'in_queue',
    BOOKING: 'booking',
    UNKNOWN: 'unknown',
  });

  const STATE_LABELS = Object.freeze({
    waiting: 'WAITING',
    in_queue: 'IN QUEUE',
    booking: 'BOOKING AVAILABLE',
    unknown: 'UNKNOWN',
  });

  // Each state has indicators. A state matches when at least `minMatches`
  // indicators match (each matching selector, text pattern or URL pattern
  // counts as one). `requireSelector` means at least one of those matches
  // must be a DOM selector, not just text.
  //
  // Booking is checked first, then queue, then waiting. Booking requires a
  // real form field because queue pages often *mention* "registration number"
  // and "postcode" ("have them ready") without being the booking page.
  const DEFAULT_CONFIG = Object.freeze({
    booking: {
      selectors: [
        'input[name*="registration" i]',
        'input[id*="registration" i]',
        'input[placeholder*="registration" i]',
        'input[aria-label*="registration" i]',
        'input[name*="postcode" i]',
        'input[id*="postcode" i]',
        'input[placeholder*="postcode" i]',
        'input[aria-label*="postcode" i]',
        '[data-ticket-helper="booking"]',
      ],
      text: ['registration (number|no\\.?|id)', 'post ?code', 'enter (your|the) registration'],
      urlPatterns: [],
      minMatches: 2,
      requireSelector: true,
    },
    queue: {
      selectors: ['#MainPart_divProgressbar', '#queue-it_log', '[data-ticket-helper="queue"]'],
      text: [
        'you are (now )?in (the )?(line|queue)',
        '(your )?number in (the )?(line|queue)',
        '(people|users) (ahead of you|in (the )?line ahead)',
        '(estimated|expected) (wait(ing)? time|time of arrival|arrival time)',
        'your (queue )?position',
        'queue ?id',
      ],
      urlPatterns: ['queue-it\\.net'],
      minMatches: 1,
      requireSelector: false,
    },
    waiting: {
      selectors: ['[data-ticket-helper="waiting"]'],
      text: [
        'waiting room',
        'sale (has not|hasn\'t) (yet )?(started|opened)',
        'sales? (starts?|opens?|will (start|open)) (in|at|on)',
        'will be (randomly )?(assigned|given) a (random )?(place|position)',
        'tickets (go|will go) on sale',
      ],
      urlPatterns: [],
      minMatches: 1,
      requireSelector: false,
    },
  });

  const ORDER = [STATES.BOOKING, STATES.IN_QUEUE, STATES.WAITING];
  const CONFIG_KEY = { booking: 'booking', in_queue: 'queue', waiting: 'waiting' };

  function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /**
   * Merge a partial user config over the defaults. Arrays given by the user
   * replace the default arrays (so users can remove a default indicator).
   */
  function mergeConfig(userConfig) {
    const base = cloneDefault();
    if (!userConfig || typeof userConfig !== 'object') return base;
    for (const key of Object.keys(base)) {
      const u = userConfig[key];
      if (!u || typeof u !== 'object') continue;
      for (const field of Object.keys(base[key])) {
        if (u[field] !== undefined) base[key][field] = u[field];
      }
    }
    return base;
  }

  function safeRegex(src) {
    try {
      return new RegExp(src, 'i');
    } catch (_) {
      return null;
    }
  }

  function evaluate(indicators, snapshot) {
    const matched = [];
    let selectorMatched = false;
    for (const sel of indicators.selectors || []) {
      let hit = false;
      try {
        hit = !!snapshot.has(sel);
      } catch (_) {
        hit = false; // invalid selector: ignore
      }
      if (hit) {
        matched.push('selector:' + sel);
        selectorMatched = true;
      }
    }
    for (const src of indicators.text || []) {
      const rx = safeRegex(src);
      if (rx && rx.test(snapshot.text || '')) matched.push('text:' + src);
    }
    for (const src of indicators.urlPatterns || []) {
      const rx = safeRegex(src);
      if (rx && rx.test(snapshot.url || '')) matched.push('url:' + src);
    }
    const ok =
      matched.length >= (indicators.minMatches || 1) &&
      (!indicators.requireSelector || selectorMatched);
    return { ok, matched };
  }

  /**
   * @param {{text: string, url: string, has: (selector: string) => boolean}} snapshot
   * @param {object} [config] result of mergeConfig(); defaults if omitted
   * @returns {{state: string, label: string, matched: string[]}}
   */
  function detectState(snapshot, config) {
    const cfg = config || cloneDefault();
    const snap = {
      text: snapshot.text || '',
      url: snapshot.url || '',
      has: typeof snapshot.has === 'function' ? snapshot.has : () => false,
    };
    for (const state of ORDER) {
      const r = evaluate(cfg[CONFIG_KEY[state]], snap);
      if (r.ok) return { state, label: STATE_LABELS[state], matched: r.matched };
    }
    return { state: STATES.UNKNOWN, label: STATE_LABELS.unknown, matched: [] };
  }

  /** Build a snapshot from a live DOM document. Read-only. */
  function snapshotFromDocument(doc, excludeEl) {
    let text = (doc.body && doc.body.innerText) || '';
    if (excludeEl && excludeEl.innerText) text = text.replace(excludeEl.innerText, '');
    return {
      text,
      url: (doc.location && doc.location.href) || '',
      has: (sel) => {
        const el = doc.querySelector(sel);
        return !!el && !(excludeEl && excludeEl.contains(el));
      },
    };
  }

  return { STATES, STATE_LABELS, DEFAULT_CONFIG, mergeConfig, detectState, snapshotFromDocument };
});
return module.exports;
})();

// ---- shared/countdown.js ----
const TicketHelperCountdown = (function () {
const module = { exports: {} };
/*
 * Sale countdowns with timezone support and one-shot warnings.
 *
 * Config format, one sale per line (blank lines and lines starting with #
 * are ignored):
 *
 *   Coach sale: 2026-10-01 18:00
 *   General sale: Sunday 09:00
 *
 * Times are wall-clock times in the configured IANA timezone
 * (e.g. "Europe/London"). A weekday form means the next occurrence of that
 * weekday; a sale that started less than `liveWindowMs` ago still counts as
 * this week's.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperCountdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MINUTE = 60 * 1000;
  const DEFAULT_LIVE_WINDOW = 2 * 60 * MINUTE;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Alerts fire once when the countdown crosses each threshold. Each alert
  // stays "due" until the next threshold so a page opened late still warns.
  const ALERTS = [
    { kind: '5min', label: 'starts in 5 minutes', at: 5 * MINUTE, until: 1 * MINUTE },
    { kind: '1min', label: 'starts in 1 minute', at: 1 * MINUTE, until: 0 },
    { kind: 'start', label: 'has started', at: 0, until: -2 * MINUTE },
  ];

  function isValidTimeZone(tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return true;
    } catch (_) {
      return false;
    }
  }

  const partsCache = {};
  function zoneParts(ms, tz) {
    const fmt =
      partsCache[tz] ||
      (partsCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'long',
      }));
    const out = {};
    for (const p of fmt.formatToParts(new Date(ms))) out[p.type] = p.value;
    return {
      year: +out.year,
      month: +out.month,
      day: +out.day,
      hour: +out.hour % 24,
      minute: +out.minute,
      second: +out.second,
      weekday: WEEKDAYS.indexOf(String(out.weekday).toLowerCase()),
    };
  }

  /** Offset of `tz` from UTC at instant `ms`, in milliseconds. */
  function tzOffset(ms, tz) {
    const p = zoneParts(ms, tz);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return asUtc - Math.floor(ms / 1000) * 1000;
  }

  /** Convert a wall-clock time in `tz` to a UTC epoch (ms). */
  function zonedTimeToUtc(year, month, day, hour, minute, tz) {
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    let result = guess - tzOffset(guess, tz);
    const second = guess - tzOffset(result, tz);
    if (second !== result) result = second; // crossed a DST boundary
    return result;
  }

  function parseTime(s) {
    const m = /^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i.exec(s.trim());
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    }
    if (h > 23 || min > 59) return null;
    return { hour: h, minute: min };
  }

  /**
   * Parse one sale spec (the part after "Label:").
   * @returns {number|null} UTC epoch ms
   */
  function parseSaleTime(spec, tz, now, liveWindowMs) {
    const s = spec.trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T]+(.+)$/.exec(s);
    if (m) {
      const t = parseTime(m[4]);
      if (!t) return null;
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return zonedTimeToUtc(y, mo, d, t.hour, t.minute, tz);
    }
    m = /^([a-z]+)\s+(.+)$/i.exec(s);
    if (m) {
      const word = m[1].toLowerCase();
      const wd = WEEKDAYS.findIndex((w) => w === word || w.slice(0, 3) === word);
      const t = parseTime(m[2]);
      if (wd < 0 || !t) return null;
      const today = zoneParts(now, tz);
      for (let add = 0; add <= 7; add++) {
        // Walk forward day by day in the target zone (noon avoids DST edges).
        const base = Date.UTC(today.year, today.month - 1, today.day + add, 12);
        const d = new Date(base);
        if (d.getUTCDay() !== wd) continue;
        const at = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), t.hour, t.minute, tz);
        if (at + liveWindowMs > now) return at;
      }
      return null;
    }
    return null;
  }

  /**
   * @returns {{sales: Array<{key: string, label: string, at: number, spec: string}>, errors: string[]}}
   */
  function parseSalesConfig(text, opts) {
    const o = opts || {};
    const tz = o.timezone || 'Europe/London';
    const now = o.now == null ? Date.now() : o.now;
    const liveWindowMs = o.liveWindowMs == null ? DEFAULT_LIVE_WINDOW : o.liveWindowMs;
    const sales = [];
    const errors = [];
    if (!isValidTimeZone(tz)) return { sales, errors: ['Unknown timezone: ' + tz] };
    String(text || '')
      .split(/\r?\n/)
      .forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith('#')) return;
        const m = /^(.+?):\s+(.+)$/.exec(line);
        if (!m) {
          errors.push(`Line ${i + 1}: expected "Label: time" — got "${line}"`);
          return;
        }
        const at = parseSaleTime(m[2], tz, now, liveWindowMs);
        if (at == null) {
          errors.push(`Line ${i + 1}: can't read the time "${m[2]}" (use "2026-10-01 18:00" or "Thursday 18:00")`);
          return;
        }
        sales.push({ key: `${m[1].trim()}@${at}`, label: m[1].trim(), at, spec: m[2].trim() });
      });
    sales.sort((a, b) => a.at - b.at);
    return { sales, errors };
  }

  function formatDuration(ms) {
    const neg = ms < 0;
    const s = Math.floor(Math.abs(ms) / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor(s / 3600) % 24;
    const m = Math.floor(s / 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return (neg ? '-' : '') + (d ? `${d}d ` : '') + `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
  }

  /** Format an instant as wall-clock time in `tz`, e.g. "Thu 01 Oct 18:00". */
  function formatInZone(ms, tz, withSeconds) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: withSeconds ? '2-digit' : undefined,
        hourCycle: 'h23',
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString();
    }
  }

  /** @returns {{phase: 'upcoming'|'live'|'ended', remaining: number, text: string}} */
  function saleStatus(sale, now, liveWindowMs) {
    const win = liveWindowMs == null ? DEFAULT_LIVE_WINDOW : liveWindowMs;
    const remaining = sale.at - now;
    if (remaining > 0) return { phase: 'upcoming', remaining, text: formatDuration(remaining) };
    if (-remaining < win) return { phase: 'live', remaining, text: 'LIVE' };
    return { phase: 'ended', remaining, text: 'ended' };
  }

  /** The first sale that has not ended yet, or null. */
  function nextSale(sales, now, liveWindowMs) {
    return sales.find((s) => saleStatus(s, now, liveWindowMs).phase !== 'ended') || null;
  }

  /**
   * Alerts that should fire now and have not fired yet. The caller records
   * each returned alert's `id` in `fired` (an object used as a set) and
   * persists it so warnings are not repeated after a reload.
   */
  function dueAlerts(sales, now, fired) {
    const out = [];
    const done = fired || {};
    for (const sale of sales) {
      const remaining = sale.at - now;
      for (const a of ALERTS) {
        const id = `${sale.key}:${a.kind}`;
        if (done[id]) continue;
        if (remaining <= a.at && remaining > a.until) {
          out.push({ id, kind: a.kind, sale, message: `${sale.label} ${a.label}` });
        }
      }
    }
    return out;
  }

  return {
    ALERTS,
    DEFAULT_LIVE_WINDOW,
    isValidTimeZone,
    zonedTimeToUtc,
    parseSaleTime,
    parseSalesConfig,
    formatDuration,
    formatInZone,
    saleStatus,
    nextSale,
    dueAlerts,
  };
});
return module.exports;
})();

// ---- shared/checkout-fields.js ----
const TicketHelperCheckout = (function () {
const module = { exports: {} };
/*
 * Parses the local checkout-info text into groups of copyable fields.
 *
 *   # Alex (lead booker)
 *   Registration: 1234567890
 *   Postcode: BA4 4BY
 *
 *   # Sam
 *   Registration: 2345678901
 *
 * Lines before the first "# heading" go into an untitled group. The values
 * are only ever copied to the clipboard by a button the user clicks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperCheckout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseCheckoutFields(text) {
    const groups = [];
    let current = null;
    const errors = [];
    String(text || '')
      .split(/\r?\n/)
      .forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;
        if (line.startsWith('#')) {
          current = { title: line.replace(/^#+\s*/, ''), fields: [] };
          groups.push(current);
          return;
        }
        const idx = line.indexOf(':');
        if (idx <= 0) {
          errors.push(`Line ${i + 1}: expected "Label: value"`);
          return;
        }
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!value) return;
        if (!current) {
          current = { title: '', fields: [] };
          groups.push(current);
        }
        current.fields.push({ label, value });
      });
    return { groups: groups.filter((g) => g.fields.length), errors };
  }

  /** Mask all but the last few characters, for display on shared screens. */
  function mask(value, visible) {
    const v = String(value);
    const keep = visible == null ? 3 : visible;
    if (v.length <= keep) return v;
    return '•'.repeat(Math.min(8, v.length - keep)) + v.slice(-keep);
  }

  const EXAMPLE = [
    '# Alex (lead booker)',
    'Name: Alex Example',
    'Registration: 1234567890',
    'Postcode: BA4 4BY',
    'Email: alex@example.com',
    '',
    '# Sam',
    'Registration: 2345678901',
    'Postcode: BS1 1AA',
  ].join('\n');

  return { parseCheckoutFields, mask, EXAMPLE };
});
return module.exports;
})();

// ---- shared/session.js ----
const TicketHelperSession = (function () {
const module = { exports: {} };
/*
 * Session model helpers shared by the dashboard server, dashboard UI and
 * userscript: status names, heartbeat health and input normalisation.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperSession = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STATUSES = ['waiting', 'in_queue', 'booking', 'unknown'];
  const STATUS_LABELS = {
    waiting: 'Waiting',
    in_queue: 'In queue',
    booking: 'Booking available',
    unknown: 'Unknown',
  };

  const HEARTBEAT_INTERVAL_MS = 10 * 1000;
  const STALE_AFTER_MS = 30 * 1000;
  const LOST_AFTER_MS = 90 * 1000;

  /** 'live' | 'stale' | 'lost' | 'never' */
  function health(lastHeartbeat, now) {
    if (!lastHeartbeat) return 'never';
    const age = now - lastHeartbeat;
    if (age < STALE_AFTER_MS) return 'live';
    if (age < LOST_AFTER_MS) return 'stale';
    return 'lost';
  }

  function cleanLabel(v, max) {
    return String(v == null ? '' : v)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, max || 60);
  }

  function normaliseStatus(s) {
    return STATUSES.includes(s) ? s : 'unknown';
  }

  /** Short, readable, unambiguous ID such as "S-7KQ3". */
  function newSessionId(rand) {
    const r = rand || Math.random;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'S-';
    for (let i = 0; i < 4; i++) id += alphabet[Math.floor(r() * alphabet.length)];
    return id;
  }

  return {
    STATUSES,
    STATUS_LABELS,
    HEARTBEAT_INTERVAL_MS,
    STALE_AFTER_MS,
    LOST_AFTER_MS,
    health,
    cleanLabel,
    normaliseStatus,
    newSessionId,
  };
});
return module.exports;
})();

// ---- notifications/ntfy.js ----
const TicketHelperNtfy = (function () {
const module = { exports: {} };
/*
 * Group notifications through ntfy (https://ntfy.sh or a self-hosted server).
 *
 * These messages go only to the group's own ntfy topic, which members
 * subscribe to in the ntfy app. Nothing here ever talks to the ticket site.
 *
 * Messages are published as JSON (POST to the server root) so titles can
 * contain non-ASCII characters such as the em dash.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperNtfy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SERVER = 'https://ntfy.sh';

  function normaliseServer(server) {
    const s = String(server || DEFAULT_SERVER).trim().replace(/\/+$/, '');
    return s || DEFAULT_SERVER;
  }

  /** ntfy topics: letters, digits, underscore and hyphen, 1-64 chars. */
  function isValidTopic(topic) {
    return typeof topic === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(topic);
  }

  function formatTime(ms, timezone) {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || undefined,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(ms));
    } catch (_) {
      return new Date(ms).toISOString().slice(11, 19);
    }
  }

  /**
   * "SAM — BOOKING PAGE DETECTED"
   * @param {{member?: string, device?: string, connection?: string, vpn?: string,
   *          sessionId?: string, at: number, timezone?: string, dashboardUrl?: string}} info
   */
  function bookingNotification(info) {
    const member = (info.member || 'Someone').trim() || 'Someone';
    const time = formatTime(info.at, info.timezone);
    const where = [info.device, info.connection, info.vpn].filter(Boolean).join(' · ');
    const lines = [`${member} reached the booking page at ${time}${info.timezone ? ` (${info.timezone})` : ''}.`];
    if (where) lines.push(`Device: ${where}`);
    if (info.sessionId) lines.push(`Session: ${info.sessionId}`);
    lines.push('Checkout is manual — get details to them now.');
    if (info.dashboardUrl) lines.push(`Dashboard: ${info.dashboardUrl}`);
    return {
      title: `${member.toUpperCase()} — BOOKING PAGE DETECTED`,
      message: lines.join('\n'),
      priority: 5,
      tags: ['rotating_light', 'tickets'],
      click: info.dashboardUrl || undefined,
    };
  }

  function saleAlertNotification(alert, info) {
    const i = info || {};
    return {
      title: alert.message,
      message: `${alert.sale.label} at ${formatTime(alert.sale.at, i.timezone)}${i.timezone ? ` (${i.timezone})` : ''}. Be on the page, don't refresh once queued.${i.dashboardUrl ? `\nDashboard: ${i.dashboardUrl}` : ''}`,
      priority: alert.kind === '5min' ? 4 : 5,
      tags: ['alarm_clock'],
      click: i.dashboardUrl || undefined,
    };
  }

  function testNotification(info) {
    const i = info || {};
    return {
      title: 'Ticket helper test',
      message: `Test notification from ${i.member || 'the group dashboard'}. If you can read this, group alerts work.`,
      priority: 3,
      tags: ['white_check_mark'],
      click: i.dashboardUrl || undefined,
    };
  }

  /**
   * Build the HTTP request for a notification. Pure: no network access.
   * @param {{server?: string, topic: string, token?: string}} config
   */
  function buildRequest(config, notification) {
    if (!config || !isValidTopic(config.topic)) {
      throw new Error('ntfy topic must be 1-64 letters, digits, "-" or "_"');
    }
    const payload = { topic: config.topic };
    for (const k of ['title', 'message', 'priority', 'tags', 'click']) {
      if (notification[k] !== undefined) payload[k] = notification[k];
    }
    const headers = { 'Content-Type': 'application/json' };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    return { method: 'POST', url: normaliseServer(config.server), headers, body: JSON.stringify(payload) };
  }

  /**
   * Send a notification. `transport(request) => Promise<{status:number}>`
   * defaults to fetch(); the userscript passes a GM_xmlhttpRequest adapter.
   */
  async function send(config, notification, transport) {
    const req = buildRequest(config, notification);
    const t =
      transport ||
      ((r) => fetch(r.url, { method: r.method, headers: r.headers, body: r.body }).then((res) => ({ status: res.status })));
    const res = await t(req);
    if (!res || res.status < 200 || res.status >= 300) {
      throw new Error(`ntfy returned HTTP ${res ? res.status : 'no response'}`);
    }
    return res;
  }

  return {
    DEFAULT_SERVER,
    isValidTopic,
    normaliseServer,
    bookingNotification,
    saleAlertNotification,
    testNotification,
    buildRequest,
    send,
  };
});
return module.exports;
})();

// ---- userscript/src/main.js ----
/*
 * Ticket Queue Helper — userscript body.
 *
 * Runs inside the tab the user opened manually. It only READS the page to
 * work out whether the tab is waiting, queued or on the booking page. It
 * never clicks, types, fills or submits anything on the ticket site, and
 * never sends requests to the ticket site. Network traffic goes only to the
 * group's own dashboard and ntfy topic, if configured.
 *
 * Available from the build: TicketHelperDetection, TicketHelperCountdown,
 * TicketHelperCheckout, TicketHelperSession, TicketHelperNtfy.
 */

const D = TicketHelperDetection;
const C = TicketHelperCountdown;
const K = TicketHelperCheckout;
const S = TicketHelperSession;
const N = TicketHelperNtfy;

const DEFAULT_SALES = ['Coach sale: 2026-10-01 18:00', 'General sale: 2026-10-04 09:00'].join('\n');
const DEFAULT_TZ = 'Europe/London';
const LOG_LIMIT = 300;
const ALARM_MAX_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- storage

// GM_* functions exist only when Tampermonkey grants them; `typeof` on an
// undeclared name is safe, so each is probed explicitly.
const GM = {
  getValue: typeof GM_getValue === 'function' ? GM_getValue : null,
  setValue: typeof GM_setValue === 'function' ? GM_setValue : null,
  notification: typeof GM_notification === 'function' ? GM_notification : null,
  xmlhttpRequest: typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null,
  setClipboard: typeof GM_setClipboard === 'function' ? GM_setClipboard : null,
  getTab: typeof GM_getTab === 'function' ? GM_getTab : null,
  saveTab: typeof GM_saveTab === 'function' ? GM_saveTab : null,
  registerMenuCommand: typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null,
};

const store = {
  get(key, dflt) {
    try {
      if (GM.getValue) return GM.getValue(key, dflt);
      const raw = localStorage.getItem('ticketHelper:' + key);
      return raw == null ? dflt : JSON.parse(raw);
    } catch (_) {
      return dflt;
    }
  },
  set(key, value) {
    try {
      if (GM.setValue) GM.setValue(key, value);
      else localStorage.setItem('ticketHelper:' + key, JSON.stringify(value));
    } catch (_) {
      /* storage unavailable: keep running */
    }
  },
};

// Per-tab state survives the queue -> booking navigation (which usually
// crosses origins). GM_getTab is Tampermonkey-specific; sessionStorage is the
// same-origin fallback.
function loadTab() {
  return new Promise((resolve) => {
    if (GM.getTab) {
      try {
        GM.getTab((t) => resolve(t || {}));
        return;
      } catch (_) {
        /* fall through */
      }
    }
    try {
      resolve(JSON.parse(sessionStorage.getItem('ticketHelperTab') || '{}'));
    } catch (_) {
      resolve({});
    }
  });
}

function saveTab() {
  try {
    if (GM.saveTab) GM.saveTab(tab);
    else sessionStorage.setItem('ticketHelperTab', JSON.stringify(tab));
  } catch (_) {
    /* ignore */
  }
}

function settings() {
  return {
    member: store.get('member', ''),
    device: store.get('device', ''),
    connection: store.get('connection', ''),
    vpn: store.get('vpn', ''),
    available: store.get('available', true),
    dashboardUrl: String(store.get('dashboardUrl', '')).trim().replace(/\/+$/, ''),
    groupKey: store.get('groupKey', ''),
    ntfyServer: store.get('ntfyServer', N.DEFAULT_SERVER),
    ntfyTopic: store.get('ntfyTopic', ''),
    salesText: store.get('salesText', DEFAULT_SALES),
    timezone: store.get('timezone', DEFAULT_TZ),
    useDashboardSales: store.get('useDashboardSales', true),
    checkoutText: store.get('checkoutText', ''),
    detectionJson: store.get('detectionJson', ''),
    protectKeys: store.get('protectKeys', true),
    protectUnload: store.get('protectUnload', false),
  };
}

// ---------------------------------------------------------------- event log

function log(type, detail) {
  const entry = { t: Date.now(), session: tab.sessionId || null, type, detail: detail || '' };
  const all = store.get('eventLog', []);
  all.push(entry);
  store.set('eventLog', all.slice(-LOG_LIMIT));
  if (ui) ui.renderLog();
}

// ---------------------------------------------------------------- detection

function detectionConfig() {
  const raw = settings().detectionJson;
  if (!raw || !raw.trim()) return D.mergeConfig(null);
  try {
    return D.mergeConfig(JSON.parse(raw));
  } catch (_) {
    return D.mergeConfig(null);
  }
}

function detectNow() {
  return D.detectState(D.snapshotFromDocument(document), detectionConfig());
}

// ---------------------------------------------------------------- alarm

let audioCtx = null;
let alarmTimer = null;
let alarmStopper = null;
let titleTimer = null;
let originalTitle = document.title;

function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (_) {
    /* no audio */
  }
}

function beep(freq, ms) {
  unlockAudio();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq || 880;
    gain.gain.value = 0.25;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (ms || 250) / 1000);
  } catch (_) {
    /* ignore */
  }
}

function beeps(n) {
  for (let i = 0; i < n; i++) setTimeout(() => beep(1046, 180), i * 300);
}

function startAlarm(message, durationMs) {
  stopAlarm(true);
  let hi = false;
  const ring = () => beep((hi = !hi) ? 988 : 740, 280);
  ring();
  alarmTimer = setInterval(ring, 400);
  alarmStopper = setTimeout(stopAlarm, durationMs || ALARM_MAX_MS);
  originalTitle = document.title.startsWith('🚨') ? originalTitle : document.title;
  let on = false;
  titleTimer = setInterval(() => {
    document.title = (on = !on) ? `🚨 ${message} 🚨` : originalTitle;
  }, 600);
  if (ui) ui.setFlashing(true, message);
  log('alarm_started', message);
}

function stopAlarm(silent) {
  const wasRinging = !!alarmTimer;
  clearInterval(alarmTimer);
  clearInterval(titleTimer);
  clearTimeout(alarmStopper);
  alarmTimer = titleTimer = alarmStopper = null;
  if (wasRinging) document.title = originalTitle;
  if (ui) ui.setFlashing(false);
  if (wasRinging && !silent) log('alarm_stopped');
}

function desktopNotify(title, text) {
  try {
    if (GM.notification) {
      GM.notification({ title, text, highlight: true, timeout: 0, onclick: () => window.focus() });
      return;
    }
  } catch (_) {
    /* fall back */
  }
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification(title, { body: text, requireInteraction: true });
    else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((p) => {
        if (p === 'granted') new Notification(title, { body: text, requireInteraction: true });
      });
    }
  } catch (_) {
    /* ignore */
  }
}

// ---------------------------------------------------------------- network (group only)

function request(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers || {});
    if (GM.xmlhttpRequest) {
      GM.xmlhttpRequest({
        method,
        url,
        headers: h,
        data: body,
        timeout: 8000,
        onload: (r) => resolve({ status: r.status, text: r.responseText }),
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout')),
      });
    } else {
      fetch(url, { method, headers: h, body })
        .then((r) => r.text().then((text) => resolve({ status: r.status, text })))
        .catch(reject);
    }
  });
}

let lastHeartbeatOk = 0;
let dashboardConfig = store.get('dashboardConfigCache', null);
let heartbeatInFlight = false;

async function heartbeat(reason) {
  const s = settings();
  if (!s.dashboardUrl || heartbeatInFlight) return false;
  heartbeatInFlight = true;
  const body = {
    member: s.member,
    device: s.device,
    connection: s.connection,
    vpn: s.vpn,
    available: s.available,
    status: currentState,
    startedAt: tab.startedAt,
    queueEnteredAt: tab.queueEnteredAt || null,
    bookingDetectedAt: tab.bookingDetectedAt || null,
    source: 'userscript',
  };
  try {
    const res = await request(
      'POST',
      `${s.dashboardUrl}/api/sessions/${encodeURIComponent(tab.sessionId)}/heartbeat`,
      JSON.stringify(body),
      s.groupKey ? { 'X-Group-Key': s.groupKey } : {}
    );
    if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
    const data = JSON.parse(res.text || '{}');
    if (data.config) {
      dashboardConfig = data.config;
      store.set('dashboardConfigCache', dashboardConfig);
    }
    if (!lastHeartbeatOk) log('dashboard_connected', s.dashboardUrl);
    lastHeartbeatOk = Date.now();
    return true;
  } catch (e) {
    if (lastHeartbeatOk || reason === 'manual') log('dashboard_error', String(e.message || e));
    lastHeartbeatOk = 0;
    return false;
  } finally {
    heartbeatInFlight = false;
    if (ui) ui.renderStatus();
  }
}

function ntfyTransport(r) {
  return request(r.method, r.url, r.body, r.headers);
}

async function notifyGroupDirect(notification) {
  const s = settings();
  if (!s.ntfyTopic) return false;
  try {
    await N.send({ server: s.ntfyServer, topic: s.ntfyTopic }, notification, ntfyTransport);
    log('group_notified', `ntfy topic ${s.ntfyTopic}: ${notification.title}`);
    return true;
  } catch (e) {
    log('group_notify_failed', String(e.message || e));
    return false;
  }
}

async function announceBooking() {
  const s = settings();
  // Tell the dashboard first: when it is reachable it notifies the group
  // itself, so members don't get the same alert twice.
  const viaDashboard = await heartbeat('booking');
  if (viaDashboard) {
    log('group_notified', 'via dashboard');
    return;
  }
  await notifyGroupDirect(
    N.bookingNotification({
      member: s.member,
      device: s.device,
      connection: s.connection,
      vpn: s.vpn,
      sessionId: tab.sessionId,
      at: tab.bookingDetectedAt,
      timezone: activeSales().timezone,
      dashboardUrl: s.dashboardUrl || undefined,
    })
  );
}

// ---------------------------------------------------------------- sales / countdown

function activeSales() {
  const s = settings();
  const fromDash = s.useDashboardSales && dashboardConfig && dashboardConfig.salesText;
  const text = fromDash ? dashboardConfig.salesText : s.salesText;
  const timezone = (fromDash && dashboardConfig.timezone) || s.timezone || DEFAULT_TZ;
  const parsed = C.parseSalesConfig(text, { timezone, now: Date.now() });
  return { sales: parsed.sales, errors: parsed.errors, timezone, source: fromDash ? 'dashboard' : 'local' };
}

const firedAlerts = {};

function checkSaleAlerts() {
  const { sales } = activeSales();
  for (const a of C.dueAlerts(sales, Date.now(), firedAlerts)) {
    firedAlerts[a.id] = true;
    log('sale_alert', a.message);
    desktopNotify('Ticket helper', a.message);
    if (ui) ui.toast(a.message);
    if (a.kind === 'start') startAlarm(a.message, 4000);
    else beeps(a.kind === '1min' ? 3 : 2);
  }
}

// ---------------------------------------------------------------- refresh protection

function protectionActive() {
  const s = settings();
  return currentState === D.STATES.IN_QUEUE && !tab.protectionDisabled && (s.protectKeys || s.protectUnload);
}

function isRefreshKey(e) {
  if (e.key === 'F5' || e.code === 'F5') return true;
  const r = e.key === 'r' || e.key === 'R' || e.code === 'KeyR';
  return r && (e.ctrlKey || e.metaKey);
}

function onKeyDown(e) {
  if (!isRefreshKey(e)) return;
  if (!protectionActive() || !settings().protectKeys) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  log('refresh_blocked', `${e.ctrlKey ? 'Ctrl+' : ''}${e.metaKey ? 'Cmd+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}`);
  if (ui) ui.toast('Refresh blocked — you are in the queue. Use "Disable protection" if you really need to reload.');
}

function onBeforeUnload(e) {
  if (!protectionActive() || !settings().protectUnload) return undefined;
  log('navigation_warning');
  e.preventDefault();
  e.returnValue = 'You are in the queue. Leaving or reloading may lose your place.';
  return e.returnValue;
}

function setProtectionDisabled(disabled) {
  tab.protectionDisabled = !!disabled;
  saveTab();
  log(disabled ? 'protection_disabled' : 'protection_enabled');
  if (ui) ui.renderStatus();
}

// ---------------------------------------------------------------- state machine

let tab = {};
let currentState = null;
let currentMatch = [];
let ui = null;

function onStateChange(next, matched) {
  const prev = currentState;
  currentState = next;
  currentMatch = matched;
  tab.lastState = next;
  log('state', `${prev ? D.STATE_LABELS[prev] : '(start)'} → ${D.STATE_LABELS[next]}`);

  if (next === D.STATES.IN_QUEUE && !tab.queueEnteredAt) {
    tab.queueEnteredAt = Date.now();
    log('queue_entered', new Date(tab.queueEnteredAt).toISOString());
  }
  if (next === D.STATES.BOOKING && !tab.bookingDetectedAt) {
    // First time this tab reaches the booking page: sound every alarm.
    tab.bookingDetectedAt = Date.now();
    log('booking_detected', new Date(tab.bookingDetectedAt).toISOString());
    startAlarm('BOOKING PAGE — complete checkout now');
    desktopNotify('BOOKING AVAILABLE', `${settings().member || 'You'}: the booking page is open. Checkout is manual — go!`);
    announceBooking();
  } else {
    heartbeat('state');
  }
  saveTab();
  if (ui) ui.renderStatus();
}

function tick() {
  const r = detectNow();
  if (r.state !== currentState) onStateChange(r.state, r.matched);
  checkSaleAlerts();
  if (ui) ui.renderClock();
}

// ---------------------------------------------------------------- UI (shadow DOM, never inside the page's DOM tree)

function createUI() {
  const host = document.createElement('ticket-helper-ui');
  host.style.all = 'initial';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap { position: fixed; top: 12px; right: 12px; z-index: 2147483647; width: 340px; max-width: calc(100vw - 24px);
    font: 13px/1.4 system-ui, -apple-system, Segoe UI, sans-serif; color: #111; }
  .badge { border-radius: 12px; padding: 10px 14px; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.3);
    cursor: pointer; user-select: none; border: 3px solid rgba(255,255,255,.6); }
  .badge .state { font: 800 26px/1.1 system-ui, sans-serif; letter-spacing: .5px; }
  .badge .sub { font-size: 13px; opacity: .95; margin-top: 2px; }
  .badge .clock { font: 600 12px/1.3 ui-monospace, monospace; margin-top: 4px; opacity: .95; }
  .s-waiting { background: #3867d6; } .s-in_queue { background: #d98b00; }
  .s-booking { background: #1e9e45; } .s-unknown { background: #666; }
  .flashing .badge { animation: pulse .5s steps(2) infinite; }
  @keyframes pulse { 0% { background: #1e9e45; } 50% { background: #d4002a; } }
  .emergency { display: none; margin-top: 6px; width: 100%; background: #b00020; color: #fff; border: 2px solid #fff;
    font-weight: 700; padding: 6px; border-radius: 8px; cursor: pointer; }
  .protected .emergency { display: block; }
  .panel { display: none; margin-top: 8px; background: #fff; border: 2px solid #222; border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.25); max-height: 70vh; overflow: auto; }
  .open .panel { display: block; }
  .tabs { display: flex; border-bottom: 1px solid #ddd; position: sticky; top: 0; background: #fff; }
  .tabs button { flex: 1; border: 0; background: none; padding: 8px 4px; cursor: pointer; font: inherit; }
  .tabs button.on { font-weight: 700; border-bottom: 3px solid #222; }
  section { display: none; padding: 10px 12px; } section.on { display: block; }
  button.b { font: inherit; padding: 4px 9px; margin: 2px 4px 2px 0; cursor: pointer; border: 1px solid #444;
    border-radius: 5px; background: #f4f4f4; color: #111; }
  button.stop { background: #b00020; color: #fff; border-color: #b00020; font-weight: 700; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 0 8px; } dt { color: #555; } dd { margin: 0; }
  label { display: block; margin-top: 8px; font-weight: 600; } label.inline { display: flex; gap: 6px; font-weight: 400; }
  input[type=text], input:not([type]), textarea, select { width: 100%; font: 12px ui-monospace, monospace; padding: 4px; margin-top: 2px; }
  .hint { color: #555; font-size: 12px; }
  .group { border-top: 1px solid #ddd; padding: 6px 0; } .group h4 { margin: 0 0 4px; }
  .field { display: flex; align-items: center; gap: 6px; } .field span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .log { font: 11px ui-monospace, monospace; white-space: pre-wrap; max-height: 40vh; overflow: auto; background: #f7f7f7; padding: 6px; }
  .toast { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); background: #111; color: #fff; padding: 10px 16px;
    border-radius: 8px; font-weight: 600; max-width: 90vw; box-shadow: 0 6px 24px rgba(0,0,0,.4); z-index: 2147483647; }
  .frame { position: fixed; inset: 0; pointer-events: none; border: 10px solid transparent; z-index: 2147483646; }
  .flashing .frame { animation: frame .5s steps(2) infinite; }
  @keyframes frame { 0% { border-color: #1e9e45; } 50% { border-color: #d4002a; } }
  .err { color: #b00020; }
</style>
<div class="outer">
<div class="frame"></div>
<div class="wrap">
  <div class="badge s-unknown" data-el="badge" title="Click to open the helper panel">
    <div class="state" data-el="state">UNKNOWN</div>
    <div class="sub" data-el="sub">Watching this tab</div>
    <div class="clock" data-el="clock"></div>
  </div>
  <button class="emergency" data-act="disable-protection">Disable refresh protection</button>
  <div class="panel">
    <div class="tabs">
      <button data-tab="status" class="on">Status</button><button data-tab="copy">Copy</button>
      <button data-tab="setup">Setup</button><button data-tab="log">Log</button>
    </div>
    <section data-sec="status" class="on">
      <button class="b stop" data-act="stop">Stop alarm</button>
      <button class="b" data-act="test-alarm">Test alarm</button>
      <button class="b" data-act="test-notify">Test notification</button>
      <dl data-el="info"></dl>
      <label class="inline"><input type="checkbox" data-el="available"> I'm available to complete checkout</label>
      <div data-el="protection"></div>
      <div data-el="sales"></div>
      <p class="hint">This helper never clicks or submits anything on the ticket site. Checkout is always done by you.</p>
    </section>
    <section data-sec="copy">
      <div data-el="copy"></div>
      <label class="inline"><input type="checkbox" data-el="reveal"> Show full values</label>
      <p class="hint">Values are stored only in this browser (Tampermonkey storage). Buttons copy to your clipboard — you paste them yourself.</p>
    </section>
    <section data-sec="setup">
      <label>Your name</label><input data-set="member" placeholder="Sam">
      <label>Device name</label><input data-set="device" placeholder="Laptop">
      <label>Connection label</label><input data-set="connection" placeholder="Home broadband">
      <label>VPN / location label (optional, for your own records)</label><input data-set="vpn" placeholder="e.g. none, or VPN – Manchester">
      <label>Group dashboard URL (optional)</label><input data-set="dashboardUrl" placeholder="http://192.168.1.20:8787">
      <label>Group key (if the dashboard uses one)</label><input data-set="groupKey">
      <label>ntfy topic for direct group alerts (used only when the dashboard is not reachable)</label><input data-set="ntfyTopic" placeholder="our-group-xk29f">
      <label>ntfy server</label><input data-set="ntfyServer">
      <label>Sale times (one per line: <code>Label: 2026-10-01 18:00</code> or <code>Label: Thursday 18:00</code>)</label>
      <textarea data-set="salesText" rows="3"></textarea>
      <label>Timezone</label><input data-set="timezone" placeholder="Europe/London">
      <label class="inline"><input type="checkbox" data-set="useDashboardSales"> Use sale times from the dashboard when connected</label>
      <label class="inline"><input type="checkbox" data-set="protectKeys"> Block F5 / Ctrl+R / Cmd+R while in queue</label>
      <label class="inline"><input type="checkbox" data-set="protectUnload"> Also warn before leaving/reloading (may delay the queue's own redirect — see README)</label>
      <label>Checkout details (<code># Person</code> headings, <code>Label: value</code> lines)</label>
      <textarea data-set="checkoutText" rows="7" placeholder="${K.EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <label>Detection overrides (JSON, optional)</label>
      <textarea data-set="detectionJson" rows="3" placeholder='{"queue": {"text": ["you are in line"]}}'></textarea>
      <div data-el="setup-errors" class="err"></div>
      <button class="b" data-act="save">Save</button>
      <button class="b" data-act="test-dashboard">Test dashboard</button>
      <button class="b" data-act="test-ntfy">Send test ntfy</button>
    </section>
    <section data-sec="log">
      <button class="b" data-act="export-log">Copy log (JSON)</button>
      <button class="b" data-act="clear-log">Clear log</button>
      <div class="log" data-el="log"></div>
    </section>
  </div>
</div>
</div>`;
  document.documentElement.appendChild(host);

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const wrap = root.querySelector('.wrap');
  const outer = root.querySelector('.outer');
  let toastTimer = null;

  function fmtTime(ms) {
    return ms ? C.formatInZone(ms, activeSales().timezone, true) : '—';
  }

  const api = {
    host,
    root,
    setFlashing(on, msg) {
      outer.classList.toggle('flashing', !!on);
      host.toggleAttribute('data-alarm', !!on);
      if (on && msg) api.toast(msg);
    },
    toast(msg) {
      let t = root.querySelector('.toast');
      if (!t) {
        t = document.createElement('div');
        t.className = 'toast';
        root.appendChild(t);
      }
      t.textContent = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.remove(), 6000);
    },
    renderStatus() {
      const s = settings();
      const st = currentState || 'unknown';
      host.setAttribute('data-state', st);
      const badge = $('badge');
      badge.className = `badge s-${st}`;
      $('state').textContent = D.STATE_LABELS[st];
      const prot = protectionActive();
      host.toggleAttribute('data-protected', prot);
      wrap.classList.toggle('protected', prot);
      $('sub').textContent =
        st === 'in_queue'
          ? prot
            ? "Don't refresh — refresh protection ON"
            : "Don't refresh — protection is OFF"
          : st === 'booking'
            ? 'Checkout is manual — complete it now'
            : st === 'waiting'
              ? 'Stay on this page'
              : 'Page not recognised — keep an eye on it';
      const dash = s.dashboardUrl ? (lastHeartbeatOk ? 'connected' : 'not reachable') : 'not configured';
      $('info').innerHTML = '';
      const rows = [
        ['Session', tab.sessionId],
        ['Member', s.member || '(set in Setup)'],
        ['Device', [s.device, s.connection, s.vpn].filter(Boolean).join(' · ') || '(set in Setup)'],
        ['Started', fmtTime(tab.startedAt)],
        ['Entered queue', fmtTime(tab.queueEnteredAt)],
        ['Booking seen', fmtTime(tab.bookingDetectedAt)],
        ['Dashboard', dash],
        ['Matched', currentMatch.slice(0, 3).join(', ') || '—'],
      ];
      for (const [k, v] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        $('info').append(dt, dd);
      }
      $('available').checked = !!s.available;
      $('protection').innerHTML = '';
      const b = document.createElement('button');
      b.className = 'b';
      b.dataset.act = tab.protectionDisabled ? 'enable-protection' : 'disable-protection';
      b.textContent = tab.protectionDisabled ? 'Re-enable refresh protection' : 'Disable refresh protection';
      $('protection').appendChild(b);
    },
    renderClock() {
      const { sales, timezone, source, errors } = activeSales();
      const now = Date.now();
      const next = C.nextSale(sales, now);
      $('clock').textContent = next
        ? `${next.label}: ${C.saleStatus(next, now).text} · ${C.formatInZone(now, timezone, true)}`
        : C.formatInZone(now, timezone, true);
      const box = $('sales');
      box.textContent = '';
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = `Sales (${source}, ${timezone}):`;
      box.appendChild(h);
      for (const sale of sales) {
        const d = document.createElement('div');
        d.textContent = `${sale.label} — ${C.formatInZone(sale.at, timezone)} — ${C.saleStatus(sale, now).text}`;
        box.appendChild(d);
      }
      for (const e of errors) {
        const d = document.createElement('div');
        d.className = 'err';
        d.textContent = e;
        box.appendChild(d);
      }
    },
    renderCopy() {
      const box = $('copy');
      box.textContent = '';
      const reveal = $('reveal').checked;
      const { groups } = K.parseCheckoutFields(settings().checkoutText);
      if (!groups.length) {
        box.textContent = 'Add checkout details under Setup to get copy buttons here.';
        return;
      }
      for (const g of groups) {
        const div = document.createElement('div');
        div.className = 'group';
        if (g.title) {
          const h = document.createElement('h4');
          h.textContent = g.title;
          div.appendChild(h);
        }
        for (const f of g.fields) {
          const row = document.createElement('div');
          row.className = 'field';
          const span = document.createElement('span');
          span.textContent = `${f.label}: ${reveal ? f.value : K.mask(f.value)}`;
          const btn = document.createElement('button');
          btn.className = 'b';
          btn.textContent = 'Copy';
          btn.addEventListener('click', () => copyText(f.value, `${g.title ? g.title + ' — ' : ''}${f.label}`));
          row.append(span, btn);
          div.appendChild(row);
        }
        box.appendChild(div);
      }
    },
    renderSetup() {
      const s = settings();
      root.querySelectorAll('[data-set]').forEach((el) => {
        const v = s[el.dataset.set];
        if (el.type === 'checkbox') el.checked = !!v;
        else el.value = v == null ? '' : v;
      });
    },
    renderLog() {
      const entries = store.get('eventLog', []).slice(-100).reverse();
      $('log').textContent = entries
        .map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.session || ''} ${e.type} ${e.detail}`)
        .join('\n');
    },
  };

  function copyText(value, label) {
    let ok = false;
    try {
      if (GM.setClipboard) {
        GM.setClipboard(value, 'text');
        ok = true;
      }
    } catch (_) {
      /* fall back */
    }
    const done = () => {
      log('copied', label);
      api.toast(`Copied ${label}`);
    };
    if (ok) return done();
    navigator.clipboard.writeText(value).then(done, () => window.prompt('Copy this:', value));
  }

  $('badge').addEventListener('click', () => {
    unlockAudio();
    if (alarmTimer) {
      stopAlarm();
      return;
    }
    wrap.classList.toggle('open');
    store.set('panelOpen', wrap.classList.contains('open'));
  });
  if (store.get('panelOpen', false)) wrap.classList.add('open');

  root.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      root.querySelectorAll('[data-sec]').forEach((x) => x.classList.toggle('on', x.dataset.sec === b.dataset.tab));
    })
  );
  $('reveal').addEventListener('change', api.renderCopy);
  $('available').addEventListener('change', (e) => {
    store.set('available', e.target.checked);
    log('availability', e.target.checked ? 'available' : 'not available');
    heartbeat('availability');
  });

  root.addEventListener('click', async (e) => {
    const act = e.target && e.target.dataset && e.target.dataset.act;
    if (!act) return;
    unlockAudio();
    if (act === 'stop') stopAlarm();
    if (act === 'test-alarm') startAlarm('Test alarm', 3000);
    if (act === 'test-notify') desktopNotify('Ticket helper test', 'Desktop notifications are working.');
    if (act === 'disable-protection') setProtectionDisabled(true);
    if (act === 'enable-protection') setProtectionDisabled(false);
    if (act === 'save') {
      const errs = [];
      root.querySelectorAll('[data-set]').forEach((el) => {
        store.set(el.dataset.set, el.type === 'checkbox' ? el.checked : el.value);
      });
      const s = settings();
      if (s.detectionJson.trim()) {
        try {
          JSON.parse(s.detectionJson);
        } catch (_) {
          errs.push('Detection overrides are not valid JSON — using defaults.');
        }
      }
      if (!C.isValidTimeZone(s.timezone)) errs.push('Unknown timezone: ' + s.timezone);
      if (s.ntfyTopic && !N.isValidTopic(s.ntfyTopic)) errs.push('ntfy topic may only contain letters, digits, - and _');
      errs.push(...C.parseSalesConfig(s.salesText, { timezone: s.timezone }).errors);
      $('setup-errors').textContent = errs.join(' ');
      log('settings_saved');
      api.toast(errs.length ? 'Saved (with warnings)' : 'Saved');
      api.renderCopy();
      api.renderStatus();
      tick();
      heartbeat('settings');
    }
    if (act === 'test-dashboard') {
      const ok = await heartbeat('manual');
      api.toast(ok ? 'Dashboard reached — this session is registered.' : 'Could not reach the dashboard. Check the URL and key.');
    }
    if (act === 'test-ntfy') {
      const s = settings();
      const ok = await notifyGroupDirect(N.testNotification({ member: s.member }));
      api.toast(ok ? 'Test notification sent to ntfy.' : 'ntfy failed — check topic/server (see Log).');
    }
    if (act === 'export-log') copyText(JSON.stringify(store.get('eventLog', []), null, 1), 'event log');
    if (act === 'clear-log') {
      store.set('eventLog', []);
      api.renderLog();
    }
  });

  api.renderSetup();
  api.renderCopy();
  api.renderLog();
  return api;
}

// ---------------------------------------------------------------- boot

async function boot() {
  tab = await loadTab();
  if (!tab.sessionId) {
    tab.sessionId = S.newSessionId();
    tab.startedAt = Date.now();
  }
  saveTab();

  ui = createUI();
  log('page_loaded', location.host + location.pathname);

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pointerdown', unlockAudio, { capture: true, once: true });
  window.addEventListener('keydown', unlockAudio, { capture: true, once: true });

  if (GM.registerMenuCommand) {
    try {
      GM.registerMenuCommand('Disable refresh protection (this tab)', () => setProtectionDisabled(true));
      GM.registerMenuCommand('Re-enable refresh protection', () => setProtectionDisabled(false));
      GM.registerMenuCommand('Stop alarm', () => stopAlarm());
    } catch (_) {
      /* ignore */
    }
  }

  tick();
  setInterval(tick, 1000);
  setInterval(() => heartbeat('interval'), S.HEARTBEAT_INTERVAL_MS);
  // React quickly to single-page transitions as well as the 1s poll.
  let pending = null;
  new MutationObserver(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const r = detectNow();
      if (r.state !== currentState) onStateChange(r.state, r.matched);
    }, 150);
  }).observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
}

boot();
})();
