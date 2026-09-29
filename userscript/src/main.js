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
