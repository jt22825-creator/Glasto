# Ticket Queue Helper

A coordination kit for a group of people who are each queueing for tickets, by hand, on their own devices.

- **Userscript** (`userscript/ticket-helper.user.js`, for Tampermonkey). It watches the tab *you* opened and shows a large **WAITING / IN QUEUE / BOOKING AVAILABLE / UNKNOWN** badge. It sounds an alarm when the booking page appears, and it blocks accidental refreshes while you're queued.
- **Group dashboard** (`npm start`). A small web page for the whole group. It shows every member's session, its heartbeat and its queue state, plus sale countdowns and local copy buttons for checkout details.
- **Group notifications** through [ntfy](https://ntfy.sh). Everyone's phone gets `SAM — BOOKING PAGE DETECTED` the moment one member's tab reaches the booking page.

> **The ticket-site interaction stays manual.** The helper never clicks, types, fills in or submits anything on the ticket site. It doesn't automate checkout or payment, and it never sends requests to the ticket provider. It makes no attempt to get around queue controls, bot detection or CAPTCHAs. Each person opens and operates their own ticket-site session.

---

## Contents

- [Project layout](#project-layout)
- [Installation](#installation)
- [Tampermonkey setup](#tampermonkey-setup)
- [Configuration](#configuration)
- [Adding group members](#adding-group-members)
- [Configuring notifications](#configuring-notifications)
- [Configuring sale times](#configuring-sale-times)
- [Using multiple independently operated devices](#using-multiple-independently-operated-devices)
- [VPN / network labelling](#vpn--network-labelling)
- [What the helper does](#what-the-helper-does)
- [What the helper deliberately does NOT do](#what-the-helper-deliberately-does-not-do)
- [Mock testing](#mock-testing)
- [Known limitations](#known-limitations)

---

## Project layout

```text
├── README.md
├── package.json
├── userscript/
│   ├── ticket-helper.user.js     ← built file you install in Tampermonkey (generated)
│   └── src/                      ← userscript sources (header.js, main.js)
├── shared/                       ← logic shared by userscript, dashboard and tests
│   ├── detection.js              page-state detection (configurable indicators)
│   ├── countdown.js              sale times, timezones, 5-min / 1-min / start alerts
│   ├── checkout-fields.js        "Label: value" checkout-detail parser
│   └── session.js                session statuses, heartbeat health, IDs
├── notifications/
│   └── ntfy.js                   ntfy message building and sending
├── server/
│   ├── server.js                 dashboard server (Node, no dependencies)
│   └── store.js                  sessions, group settings, persistence
├── dashboard/                    index.html, app.js, styles.css
├── mock/                         mock ticket-sale pages + in-browser test runner
├── scripts/build-userscript.js   inlines shared/ into the userscript
└── tests/                        unit tests (node:test) and e2e/ (Playwright)
```

---

## Installation

You need **Node.js 18 or later** on whichever computer hosts the dashboard. Members who only use the userscript or open the dashboard in a browser don't need Node.

```bash
git clone https://github.com/jt22825-creator/glasto.git
cd glasto
npm install          # only needed for the browser (e2e) tests; the server has no dependencies
npm start            # starts the dashboard on port 8787
```

`npm start` prints the addresses it's reachable on:

```text
Ticket helper dashboard running.
  This computer:   http://localhost:8787/
  On your network: http://192.168.1.20:8787/
  Mock pages:      http://localhost:8787/mock/
  Userscript:      http://localhost:8787/userscript/ticket-helper.user.js
```

Server options are environment variables:

| Variable    | Default           | Meaning                                                        |
| ----------- | ----------------- | -------------------------------------------------------------- |
| `PORT`      | `8787`            | Port to listen on                                              |
| `HOST`      | `0.0.0.0`         | Interface to bind (`127.0.0.1` = this computer only)           |
| `GROUP_KEY` | (none)            | Shared passphrase required for every `/api` call               |
| `DATA_FILE` | `data/state.json` | Where sessions and group settings are saved (git-ignored)      |

Example: `GROUP_KEY=pick-a-long-phrase PORT=9000 npm start`

### Letting members in other households reach the dashboard

Members on other connections (mobile data, other homes) can't reach `192.168.x.x`. Use one of these:

- A private mesh VPN such as **Tailscale** or ZeroTier. Everyone joins your tailnet and opens `http://<host-tailscale-name>:8787/`. This is the simplest and most private option.
- A small cloud VM or a home server with port forwarding. **Set `GROUP_KEY`** if the dashboard is reachable from the internet.
- A tunnelling service such as Cloudflare Tunnel. Again, set `GROUP_KEY`.

The dashboard is optional. Without it, the userscript still does everything locally and can notify the group directly through ntfy.

---

## Tampermonkey setup

1. Install **Tampermonkey** in the browser you'll queue in (Chrome, Edge, Firefox or Safari). On Android, use Firefox with Tampermonkey. On iOS/iPadOS, use Safari with the Tampermonkey or "Userscripts" extension.
2. In Chrome and Edge, allow userscripts: open the extension's details, turn on **Allow user scripts**, and turn on Developer mode if your browser version asks for it.
3. Install the script. Either:
   - open `http://<dashboard>/userscript/ticket-helper.user.js` and Tampermonkey will offer to install it, or
   - Tampermonkey → *Create a new script* → paste the contents of `userscript/ticket-helper.user.js` → Save.
4. The script runs on `*.seetickets.com`, `*.queue-it.net` and the local mock pages. For a different ticket site, add it under Tampermonkey → the script → *Settings* → **User matches** (e.g. `https://tickets.example.com/*`).
5. The first time the script contacts your dashboard or ntfy, Tampermonkey asks you to allow the domain. Click **Always allow domain**.
6. Open the ticket site. Click the badge in the top-right, then open **Setup** (see below).
7. Click **Test alarm** once on each device. Browsers only play sound after you've interacted with the page.

---

## Configuration

Everything is set in the userscript's **Setup** tab. Settings are stored in Tampermonkey's storage on that browser only.

| Setting | Purpose |
| --- | --- |
| Your name / Device name / Connection label | Shown on the dashboard and in notifications ("Sam · Laptop · Home broadband") |
| VPN / location label | Optional free-text label for your own records. See [VPN / network labelling](#vpn--network-labelling) |
| Group dashboard URL | e.g. `http://100.64.0.5:8787`. Enables heartbeats and dashboard notifications |
| Group key | Only if the server was started with `GROUP_KEY` |
| ntfy topic / server | Direct group alerts, used **only when the dashboard is unreachable or not set** |
| Sale times / Timezone | Local countdowns. By default, times from the dashboard are used when connected |
| Block F5 / Ctrl+R / Cmd+R | On by default |
| Also warn before leaving/reloading | Off by default. See [limitations](#known-limitations) |
| Checkout details | Copy-button values. See below |
| Detection overrides | JSON that replaces the default page indicators. See below |

After saving, click **Test dashboard** and **Send test ntfy** to check connectivity.

### Detection indicators

The badge state comes from **indicators**: CSS selectors, text patterns (case-insensitive regular expressions) and URL patterns. States are checked in this order: booking, then queue, then waiting. If none matches, the state is UNKNOWN. The defaults are in `shared/detection.js`:

- **BOOKING AVAILABLE** needs at least two matching indicators, and at least one must be a real form field (e.g. an `<input>` whose name or placeholder contains *registration* or *postcode*). Queue pages often *mention* "have your registration number and postcode ready", and that text alone must not trigger the alarm.
- **IN QUEUE** matches text like "you are now in line", "number in line", "people ahead of you", "estimated wait time", a Queue-it progress bar, or a `queue-it.net` URL.
- **WAITING** matches "waiting room", "sale has not started", "tickets go on sale" and similar.

To change them, paste JSON into **Detection overrides**. Each key you supply replaces the default list for that state; everything else keeps its default:

```json
{
  "queue":   { "text": ["you are in line", "your place in the queue"] },
  "booking": { "selectors": ["#basket-form input[name='regNo']", "input[name='postcode']"], "minMatches": 1 },
  "waiting": { "text": ["the sale opens at"] }
}
```

The **Matched** row on the Status tab shows which indicators fired. Use it to tune the patterns on the day.

---

## Adding group members

Each member sets up their own devices. Nobody else controls them.

1. The host runs `npm start` and shares the dashboard URL, plus the group key if one is set.
2. Each member installs the userscript on each device they'll queue on, then enters **their own name, the device name and the connection label** under Setup, along with the dashboard URL.
3. Each device gets a **session ID** (e.g. `S-7KQ3`) per browser tab. It appears in the dashboard table as soon as the first heartbeat arrives (every 10 seconds).
4. Devices without the userscript can be registered by hand: dashboard → **Register a session**. The member then sets their status with the buttons under *Sessions registered from this browser*. That page sends a heartbeat every 10 seconds while it stays open.

The dashboard table shows, per session: ID, member, device, connection, VPN/location label, start time, status, time it entered the queue, time the booking page was detected, and last heartbeat. Heartbeat health is shown as live (under 30 s), stale (under 90 s) or lost. It also shows **Available to check out**, which the member toggles in the userscript or anyone can toggle on the dashboard.

**Reset** clears a session's queue and booking times between sales. **Remove** takes it off the dashboard. Neither affects the member's ticket-site tab.

---

## Configuring notifications

The helper alerts you in three ways.

1. **On the device that got through.** An alarm loops until you click the badge or **Stop alarm** (or for up to 5 minutes). The tab title and a page border flash, and a desktop notification appears through Tampermonkey.
2. **On every open dashboard.** A banner reads `SAM — BOOKING PAGE DETECTED`, with an alarm and a browser notification. Click **Enable sound & notifications** once on each dashboard tab.
3. **On everyone's phones, through ntfy:**
   1. Pick a long, hard-to-guess topic name, e.g. `glasto-crew-7f3k9q2m`. Anyone who knows a topic on the public ntfy.sh server can read it, so don't put personal data in it.
   2. Everyone installs the **ntfy** app (Android / iOS) and subscribes to that topic. For urgent alerts, allow ntfy to bypass Do Not Disturb.
   3. On the dashboard → **Group settings**: tick *Send group notifications* and enter the topic. Optionally set the server if you self-host ntfy, and an access token for protected topics. Put the dashboard's public URL in *Dashboard link* so tapping the notification opens it. Save, then click **Send test notification**.
   4. Optionally, also enter the same topic in each userscript's Setup. This is the fallback: if a device can't reach the dashboard at the moment it hits the booking page, it notifies ntfy directly. When the dashboard is reachable, the dashboard sends the notification instead, so nobody gets it twice.

Example notification:

```text
SAM — BOOKING PAGE DETECTED
Sam reached the booking page at 09:03:12 (Europe/London).
Device: Laptop · Home broadband
Session: S-7KQ3
Checkout is manual — get details to them now.
Dashboard: http://100.64.0.5:8787/
```

The dashboard can also push **"starts in 5 minutes"**, **"starts in 1 minute"** and **"has started"** for each sale. This is on by default whenever ntfy is enabled.

Notifications only go to your group's ntfy topic. They never send anything to, or take any action on, the ticket website.

---

## Configuring sale times

On the dashboard → **Group settings** → *Sale times*, one sale per line:

```text
Coach sale: 2026-10-01 18:00
General sale: Sunday 09:00
```

- **Format:** `Label: YYYY-MM-DD HH:MM` or `Label: Weekday HH:MM`. A weekday means its next occurrence. `6:00pm` and `thu` also work.
- **Timezone:** any IANA name (`Europe/London`, `America/New_York`, …). Times are wall-clock times in that zone, including daylight-saving changes.
- **Persistence:** saved in `data/state.json` on the server and shared with every userscript through its heartbeat. A userscript without a dashboard uses the sale times in its own Setup, which are saved in Tampermonkey storage.
- **Warnings:** a toast, beeps and a desktop notification at **5 minutes**, **1 minute** and **at the start**, plus the optional ntfy pushes. A sale counts as *LIVE* for two hours after it starts.

The default configuration is the Glastonbury 2027 sales: coach sale Thu 1 Oct 2026 18:00, general sale Sun 4 Oct 2026 09:00, Europe/London.

---

## Using multiple independently operated devices

The helper helps a group keep track of many sessions that people run themselves. It does not create sessions.

- **Each session is opened by a person, in their own browser, on their own device.** The helper never opens tabs, launches browsers, or drives a browser for you.
- **Give each session clear labels** (member, device, connection) so the dashboard answers "who's in, on what, and are they available?" at a glance. For example:

  | Member | Device  | Connection     | Status            |
  | ------ | ------- | -------------- | ----------------- |
  | Alex   | iPhone  | Mobile         | In queue          |
  | Sam    | Laptop  | Home broadband | Booking available |
  | Jamie  | Android | Mobile         | In queue          |

- **Read and follow the ticket seller's rules** on devices, tabs and connections for each sale, and don't do anything the seller prohibits. Some sellers treat many tabs or sessions from one person or connection as abuse and may cancel them.
- **Decide checkout roles in advance.** Whoever gets through books for the group, so keep the **Available to check out** flag accurate. Make sure everyone who might check out has the group's details on the **Copy** tab (userscript) or in **Checkout details** (dashboard). These are stored only on that device. Share them among yourselves beforehand in whatever way you trust.
- **When someone gets through,** everyone else sees the banner and gets the ntfy push. The person who got through completes checkout by hand. Others stay in their own queues until the group confirms the booking is done.

---

## VPN / network labelling

Each session can record a free-text **VPN / location label**, plus the **connection label**. These are only notes that help the group see which sessions are on which network, e.g. `Home broadband (Virgin)`, `Mobile data (EE)`, `Office Wi-Fi`, `VPN – Manchester`, `none`.

- Set them in the userscript's **Setup** tab, or when registering a session on the dashboard.
- **You** choose and type the label. The helper doesn't detect, check or change your network.
- If you connect through a VPN, you do that yourself, outside this tool, and label the session so the group knows.
- Many ticket sellers and queue systems block or penalise VPN and datacentre traffic, or forbid it in their terms. A VPN label is for your group's own records only. Check the seller's rules before using a VPN for a sale.

The helper does **not** implement automatic VPN switching, IP rotation, VPN cycling, proxy rotation, or automated creation of network identities.

---

## What the helper does

- Reads the page you opened to classify it as WAITING, IN QUEUE, BOOKING AVAILABLE or UNKNOWN, using configurable DOM, text and URL indicators.
- Shows a large colour-coded status badge. Its UI sits in a shadow root outside the page body, so its own text never affects detection.
- Records when this tab **entered the queue** and when the **booking page was detected**. The times survive the queue → booking navigation through Tampermonkey's per-tab storage.
- On first detecting the booking page, it sounds a looping alarm, flashes the title and page border, and shows a desktop notification. It also tells the dashboard (which notifies the group) or, if the dashboard is unreachable, notifies ntfy directly.
- While you're in the queue, it blocks **F5**, **Ctrl+R**, **Ctrl+Shift+R** and **Cmd+R**, and optionally warns before you leave the page. A red **Disable refresh protection** button sits under the badge, and the same option is in the Tampermonkey menu.
- Keeps a **local event log**: state changes, queue entry, booking detection, blocked refreshes, alarms, copies and dashboard or ntfy results. You can copy it as JSON from the **Log** tab.
- Provides **copy buttons** for checkout details (values are masked unless you tick *Show full values*).
- Shows sale countdowns with 5-minute, 1-minute and start warnings.
- Sends a heartbeat to the group dashboard every 10 seconds and on every state change: status, labels, times, and availability.

## What the helper deliberately does NOT do

- ❌ No automated checkout or payment. It never clicks, types into, fills in or submits anything on the ticket site. Copy buttons only put text on *your* clipboard.
- ❌ No automated submission of ticket orders.
- ❌ No requests to the ticket provider, no API calls, no network attacks, no request interception, no reverse engineering of private APIs.
- ❌ No circumventing queue controls. It never refreshes, re-queues or navigates the tab.
- ❌ No bot-detection evasion, no disguising automation as human browsing, no CAPTCHA solving. None of these are implemented, even though some were in the original wish-list.
- ❌ No launching or controlling browser sessions, including extra sessions or tabs.
- ❌ No VPN switching, IP or proxy rotation, or creation of network identities.
- ❌ The dashboard and notifications only communicate between group members. They never send commands to the ticket website.

`tests/boundaries.test.js` scans the userscript for programmatic clicks, form submits, synthetic events, field filling, navigation, and CAPTCHA or automation-disguise code. The test suite fails if any of that is added.

---

## Mock testing

Never test against the real ticket site. The repository includes mock pages served by the dashboard server:

| Page | Simulates | Expected badge |
| --- | --- | --- |
| `/mock/presale.html` | Pre-sale countdown / waiting room (`?queueIn=5` moves into the queue after 5 s) | WAITING |
| `/mock/queue.html` | Queue page (mentions registration/postcode, to test false positives) | IN QUEUE |
| `/mock/long-queue.html` | Long queue, text only | IN QUEUE |
| `/mock/queue-progress.html?start=15` | Queue that counts down and then redirects itself to booking | IN QUEUE → BOOKING AVAILABLE |
| `/mock/booking.html` | Booking form (submits nowhere) | BOOKING AVAILABLE |
| `/mock/unknown.html` | Unrelated page | UNKNOWN |

**Manual check with the real userscript:** run `npm start`, install the userscript, and open `http://localhost:8787/mock/`. Open each page in its own tab. On the queue page, press F5 or Ctrl/Cmd+R: you should see "Refresh blocked". Then open `queue-progress.html?start=15` and wait for the alarm.

**In-browser test runner:** `http://localhost:8787/mock/test-runner.html`. It automatically checks detection on every mock page, sale-time parsing and a heartbeat round-trip. Buttons walk you through the alarm, desktop notification, copy/paste, a compressed 70-second countdown (5-min, 1-min and start warnings) and a group ntfy test.

**Automated tests:**

```bash
npm test          # unit + integration tests (no browser): detection, countdown/timezones,
                  # notifications, heartbeat/server API, checkout fields, boundaries
npm run test:e2e  # Chromium via Playwright: the built userscript on every mock page,
                  # queue→booking alarm + notification + recorded times, F5/Ctrl+R/Cmd+R
                  # blocking and the disable control, beforeunload warning, dashboard
                  # heartbeat + group ntfy (to a local fake ntfy server), direct ntfy fallback,
                  # copy buttons, countdown warning, dashboard banner/alarm, test runner
npm run test:all  # both
```

The e2e tests inject the userscript with Tampermonkey-style `GM_*` stubs and use a local fake ntfy server, so nothing leaves your machine. If you edit `userscript/src/` or `shared/`, run `npm run build`. `npm test` fails if the built userscript is out of date.

---

## Known limitations

- **Detection is pattern-based.** The default indicators are educated guesses from past sales. Real pages change. Check that the badge says IN QUEUE once you're queued, watch the **Matched** row, and adjust **Detection overrides** if needed. If the badge says UNKNOWN, keep an eye on the tab yourself.
- **Refresh protection can't catch everything.** Pages can intercept F5, Ctrl+R and Cmd+R only while the page itself has keyboard focus. Browser toolbar buttons, the address bar, closing the tab, mobile pull-to-refresh and some Safari shortcuts can't be blocked. The optional "warn before leaving" prompt (`beforeunload`) covers some of these. It is **off by default**, because it can also pop up when the queue page itself redirects you to the booking page, delaying you until you click *Leave*. Browsers also show it only after you've clicked on the page.
- **Sound needs a prior click.** Browsers block audio until you interact with a page. The queue → booking redirect loads a *new* page, so the alarm may be silent there if you haven't clicked it. The desktop notification, the flashing tab, the dashboard alarm and the ntfy push don't depend on this. Click **Test alarm** before the sale, and keep the dashboard open with **Enable sound & notifications** clicked. In Firefox you can allow autoplay for the ticket site.
- **Background tabs are throttled.** Browsers slow timers in background tabs, so detection and heartbeats may lag by a second or so. Mobile browsers may suspend background tabs entirely. On phones, keep the ticket tab in the foreground.
- **Phones:** userscript support on mobile is limited (see Tampermonkey setup). Use manual dashboard sessions and ntfy on devices that can't run it.
- **Per-tab session IDs** rely on Tampermonkey's `GM_getTab`. Other userscript managers fall back to `sessionStorage`, which doesn't survive a cross-site redirect. The alarm still fires, but the tab may get a new session ID.
- **Clock differences:** queue and booking times come from each device's clock. Heartbeat ages use the server's clock.
- **The dashboard has no user accounts.** Anyone with the URL (and key, if set) can edit sessions and settings. It's meant for a small, trusted group. Use `GROUP_KEY` and a private network such as Tailscale.
- **Public ntfy topics are readable by anyone who guesses the name.** Use a long random topic, or a self-hosted or protected ntfy server with a token. Never put checkout details in notifications (the helper doesn't).
- **Checkout details are stored unencrypted** in Tampermonkey storage or browser localStorage on each device. Use **Delete from this device** on the dashboard, or clear the userscript's field, when you're done.
