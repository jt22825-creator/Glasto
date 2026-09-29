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
