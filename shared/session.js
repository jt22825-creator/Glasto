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
