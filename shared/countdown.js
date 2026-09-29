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
