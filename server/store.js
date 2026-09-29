/*
 * Group state: registered sessions, shared config and a group event log.
 * Persisted as JSON. Contains no checkout details — those stay on each
 * member's own device.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../shared/session');
const C = require('../shared/countdown');
const N = require('../notifications/ntfy');

const ID_RX = /^S-[A-Z0-9]{4,12}$/;
const EVENT_LIMIT = 200;

const DEFAULT_CONFIG = {
  groupName: 'Our group',
  salesText: 'Coach sale: 2026-10-01 18:00\nGeneral sale: 2026-10-04 09:00',
  timezone: 'Europe/London',
  dashboardUrl: '',
  ntfy: { enabled: false, server: N.DEFAULT_SERVER, topic: '', token: '' },
  notifySaleAlerts: true,
};

class GroupStore {
  /**
   * @param {{file?: string, now?: () => number, onChange?: () => void,
   *          onBooking?: (session: object) => void}} opts
   */
  constructor(opts) {
    const o = opts || {};
    this.file = o.file || null;
    this.now = o.now || Date.now;
    this.onChange = o.onChange || (() => {});
    this.onBooking = o.onBooking || (() => {});
    this.state = { sessions: {}, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), events: [], firedAlerts: {} };
    this.saveTimer = null;
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return this;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state.sessions = data.sessions || {};
      this.state.events = data.events || [];
      this.state.firedAlerts = data.firedAlerts || {};
      this.state.config = Object.assign({}, this.state.config, data.config || {});
      this.state.config.ntfy = Object.assign({}, DEFAULT_CONFIG.ntfy, (data.config && data.config.ntfy) || {});
    } catch (e) {
      console.error(`Could not read ${this.file}: ${e.message}. Starting empty.`);
    }
    return this;
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  changed() {
    this.save();
    this.onChange();
  }

  event(type, text, sessionId) {
    this.state.events.push({ t: this.now(), type, text, session: sessionId || null });
    if (this.state.events.length > EVENT_LIMIT) this.state.events.splice(0, this.state.events.length - EVENT_LIMIT);
  }

  newId() {
    let id;
    do id = S.newSessionId();
    while (this.state.sessions[id]);
    return id;
  }

  applyLabels(session, input) {
    for (const k of ['member', 'device', 'connection', 'vpn']) {
      if (input[k] !== undefined) session[k] = S.cleanLabel(input[k]);
    }
    if (input.available !== undefined) session.available = !!input.available;
  }

  applyStatus(session, input) {
    if (input.status === undefined || input.status === null) return;
    const now = this.now();
    const status = S.normaliseStatus(input.status);
    const prev = session.status;
    session.status = status;
    if (isFiniteTime(input.queueEnteredAt)) session.queueEnteredAt = session.queueEnteredAt || input.queueEnteredAt;
    if (isFiniteTime(input.bookingDetectedAt)) session.bookingDetectedAt = session.bookingDetectedAt || input.bookingDetectedAt;
    if (status === 'in_queue' && !session.queueEnteredAt) session.queueEnteredAt = now;
    if (status === 'booking' && !session.bookingDetectedAt) session.bookingDetectedAt = now;
    if (prev !== status) this.event('status', `${describe(session)}: ${S.STATUS_LABELS[prev] || 'new'} → ${S.STATUS_LABELS[status]}`, session.id);
    if (status === 'booking' && !session.bookingNotifiedAt) {
      session.bookingNotifiedAt = now;
      this.event('booking', `${describe(session)} reached the booking page`, session.id);
      this.onBooking(session);
    }
  }

  create(id, input) {
    const now = this.now();
    const session = {
      id,
      member: '',
      device: '',
      connection: '',
      vpn: '',
      available: true,
      status: 'unknown',
      source: input.source === 'userscript' ? 'userscript' : 'manual',
      startedAt: isFiniteTime(input.startedAt) ? input.startedAt : now,
      registeredAt: now,
      queueEnteredAt: null,
      bookingDetectedAt: null,
      bookingNotifiedAt: null,
      lastHeartbeat: null,
    };
    this.applyLabels(session, input);
    this.state.sessions[id] = session;
    this.event('registered', `${describe(session)} registered (${session.source})`, id);
    return session;
  }

  /** Register a session. Returns the new session. */
  register(input) {
    const i = input || {};
    if (!S.cleanLabel(i.member)) throw httpError(400, 'member name is required');
    const id = i.id && ID_RX.test(i.id) && !this.state.sessions[i.id] ? i.id : this.newId();
    const session = this.create(id, i);
    session.lastHeartbeat = this.now();
    this.applyStatus(session, i);
    this.changed();
    return session;
  }

  /** Heartbeat from a session; creates it if the server hasn't seen it. */
  heartbeat(id, input) {
    if (!ID_RX.test(id || '')) throw httpError(400, 'bad session id');
    const i = input || {};
    let session = this.state.sessions[id];
    if (!session) {
      if (!S.cleanLabel(i.member)) i.member = 'Unnamed';
      session = this.create(id, i);
    }
    this.applyLabels(session, i);
    if (session.lostNoted) session.lostNoted = false;
    session.lastHeartbeat = this.now();
    this.applyStatus(session, i);
    this.changed();
    return session;
  }

  update(id, patch) {
    const session = this.state.sessions[id];
    if (!session) throw httpError(404, 'no such session');
    this.applyLabels(session, patch || {});
    this.applyStatus(session, patch || {});
    this.changed();
    return session;
  }

  remove(id) {
    const session = this.state.sessions[id];
    if (!session) throw httpError(404, 'no such session');
    delete this.state.sessions[id];
    this.event('removed', `${describe(session)} removed`, id);
    this.changed();
  }

  /** Reset a session's queue/booking times so it can be reused for another sale. */
  reset(id) {
    const session = this.state.sessions[id];
    if (!session) throw httpError(404, 'no such session');
    Object.assign(session, { status: 'unknown', queueEnteredAt: null, bookingDetectedAt: null, bookingNotifiedAt: null });
    this.event('reset', `${describe(session)} reset`, id);
    this.changed();
    return session;
  }

  setConfig(patch) {
    const p = patch || {};
    const c = this.state.config;
    if (p.groupName !== undefined) c.groupName = S.cleanLabel(p.groupName, 80) || DEFAULT_CONFIG.groupName;
    if (p.timezone !== undefined) {
      if (!C.isValidTimeZone(p.timezone)) throw httpError(400, 'unknown timezone: ' + p.timezone);
      c.timezone = p.timezone;
    }
    if (p.salesText !== undefined) {
      const parsed = C.parseSalesConfig(p.salesText, { timezone: c.timezone, now: this.now() });
      if (parsed.errors.length) throw httpError(400, parsed.errors.join('; '));
      c.salesText = String(p.salesText);
    }
    if (p.dashboardUrl !== undefined) c.dashboardUrl = String(p.dashboardUrl).trim().slice(0, 300);
    if (p.notifySaleAlerts !== undefined) c.notifySaleAlerts = !!p.notifySaleAlerts;
    if (p.ntfy) {
      const n = Object.assign({}, c.ntfy);
      if (p.ntfy.enabled !== undefined) n.enabled = !!p.ntfy.enabled;
      if (p.ntfy.server !== undefined) n.server = N.normaliseServer(p.ntfy.server);
      if (p.ntfy.topic !== undefined) n.topic = String(p.ntfy.topic).trim();
      if (p.ntfy.token !== undefined && p.ntfy.token !== '********') n.token = String(p.ntfy.token).trim();
      if (n.enabled && !N.isValidTopic(n.topic)) throw httpError(400, 'ntfy topic may only contain letters, digits, - and _');
      c.ntfy = n;
    }
    this.event('config', 'Settings updated');
    this.changed();
    return this.publicConfig();
  }

  publicConfig() {
    const c = this.state.config;
    return {
      groupName: c.groupName,
      salesText: c.salesText,
      timezone: c.timezone,
      dashboardUrl: c.dashboardUrl,
      notifySaleAlerts: c.notifySaleAlerts,
      ntfy: { enabled: c.ntfy.enabled, server: c.ntfy.server, topic: c.ntfy.topic, token: c.ntfy.token ? '********' : '' },
    };
  }

  /** Mark sessions that have gone quiet, once. Returns true if anything changed. */
  sweep() {
    const now = this.now();
    let changed = false;
    for (const s of Object.values(this.state.sessions)) {
      if (S.health(s.lastHeartbeat, now) === 'lost' && !s.lostNoted && s.source === 'userscript') {
        s.lostNoted = true;
        this.event('lost', `${describe(s)}: no heartbeat for ${Math.round(S.LOST_AFTER_MS / 1000)}s`, s.id);
        changed = true;
      }
    }
    if (changed) this.changed();
    return changed;
  }

  snapshot() {
    const now = this.now();
    const sessions = Object.values(this.state.sessions)
      .map((s) => Object.assign({}, s, { health: S.health(s.lastHeartbeat, now) }))
      .sort((a, b) => a.member.localeCompare(b.member) || a.registeredAt - b.registeredAt);
    return { serverTime: now, config: this.publicConfig(), sessions, events: this.state.events.slice(-50) };
  }
}

function describe(s) {
  return [s.member || 'Unnamed', s.device].filter(Boolean).join(' / ') + ` (${s.id})`;
}

function isFiniteTime(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { GroupStore, DEFAULT_CONFIG, describe };
