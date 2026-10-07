# Name Royale

A "chat plays" game for YouTube live streams. Viewers type `!join` in live chat and a ball with their name drops into a round arena. The edge slowly shrinks, balls get knocked off, and the last ball left wins.

> **Status: Stage 2 (the game, driven by fake chat).** Full rounds work with the simulator. The leaderboard is kept in memory until Stage 4, so it resets when you restart the server.

## Roadmap

- [x] **Stage 1:** project scaffold, this README, server ↔ game connection, fake chat simulator
- [x] **Stage 2:** the game itself (rounds, physics, shrinking arena, bots, podium), driven by the simulator
- [ ] **Stage 3:** real YouTube live chat
- [ ] **Stage 4:** leaderboard saved to disk
- [ ] **Stage 5:** polish: sound, particles, screen shake, final vertical layout

---

## How it fits together

```
 YouTube live chat ─┐
                    ├─► Node server ──WebSocket──► Game page ──► OBS Browser Source ──► YouTube
 Fake chat (sim) ───┘   (server/)                   (src/)
                        • reads chat                • physics and rounds
                        • cooldowns, bans,          • draws everything
                          name filter               • reports who won
                        • leaderboard file  ◄───────┘
```

- The **game page** runs inside OBS as a Browser Source. It owns the physics and the round timer.
- The **server** is a small Node.js program on the same laptop. It reads chat (real or fake), drops spam and banned users, and passes commands to the game. When a round ends, the game tells the server the result and the server updates the leaderboard file.
- One command (`npm run sim` or `npm run live`) starts both, so you only need one terminal window.

## What gets installed (dependencies)

| Package | Why it's needed |
|---|---|
| `phaser` (v3) | Game engine. Draws the game, includes the Matter.js physics engine, and handles text, tweens, particles and sound. One package covers all of these. |
| `ws` | Lets the Node server talk to the game page over a WebSocket. Node can't host a WebSocket server without it. |
| `vite` *(dev)* | Serves the game page to OBS and reloads it instantly while you edit code. |
| `typescript` *(dev)* | Type-checks the code (`npm run typecheck`). It isn't needed to run the game. |
| `@types/node`, `@types/ws` *(dev)* | Type information for the two above. No code runs from these. |

YouTube is called with Node's built-in `fetch`, so there's no Google SDK. Node runs the server's TypeScript files directly, so no build step is needed for the server either.

---

## 1. Install the tools (one time)

### Node.js
1. Go to <https://nodejs.org> and download the **LTS** version (24.x). Install it with the default options.
   - Version **22.18 or newer** also works. Older versions fail with `Unknown file extension ".ts"`.
2. Check it worked. Open **Terminal** (Mac) or **PowerShell** (Windows) and run:
   ```
   node --version
   ```
   You should see `v24.something` (or `v22.18` or newer).

### Get the project and install
In the terminal, go to the `name-royale` folder and install the packages:
```
cd path/to/Glasto/name-royale
npm install
```
This creates a `node_modules` folder. It takes about a minute the first time.

## 2. Try it with fake chat (no YouTube needed)

```
npm run sim
```

You'll see:
```
[hub] Waiting for the game on ws://localhost:8787
[game] Vertical:  http://localhost:5173/
[game] Landscape: http://localhost:5173/?layout=landscape
```

Open <http://localhost:5173/> in Chrome, Edge or Safari. Fake viewers start joining right away.

**Short rounds for testing:** add `?quick` to the address (<http://localhost:5173/?quick>). The join window is then 12 seconds and fights last under a minute.

The game is **vertical (1080x1920) by default**, made for Shorts-style live streams watched on phones. Add `?layout=landscape` for a 1920x1080 version.

**You can also chat yourself.** Click into the terminal window and type a line, then press Enter:

| Type this | What happens |
|---|---|
| `alice !join` | A viewer called "alice" sends `!join` |
| `alice !colour mint` | alice picks a colour |
| `superchat alice 5` | alice sends a $5 Super Chat |
| `sponsor alice` | alice becomes a channel member |
| `flood 40` | 40 new fake viewers all type `!join` within 3 seconds |
| `pause` / `resume` | Stop or restart the random fake viewers |

Press **Ctrl+C** to stop everything.

## How a round works

1. **Join (45 s).** Each `!join` drops a ball into the arena. Balls get smaller as more people join, so a busy round still fits. A soft wall keeps everyone in while people are still joining.

   **Crowded rounds:** when more than 18 balls are alive, only 15 show full names and the rest show initials (e.g. `NG` for NeonGecko). While people are joining, the 15 newest arrivals get full names. During the fight, it's the 15 nearest the edge, because they're the ones about to go.
2. **Fight.** If fewer than 12 balls joined, bots (`bot_pebble`, `bot_waffle`, …) fill the gap. After 10 seconds the yellow edge starts closing in, and it reaches nothing after another 150 seconds. Any ball whose centre crosses the edge is out. Balls drift towards the middle, so the pack gets squeezed as the arena shrinks. Every 12–20 seconds a chaos event fires:
   - **Shockwave:** a red ring warns you, then everything nearby is blasted outward.
   - **Swirl:** the whole arena spins for a few seconds.
   - **Quake:** every ball gets a random shove.
3. **Final two.** The screen edge pulses red and both balls get a "♥ 1 HP" tag.
4. **Winner (10 s).** A podium shows 1st, 2nd and 3rd, plus the winner's all-time wins.
5. **Countdown (5 s),** then the next join window opens. A `!join` typed after the window closes is queued for the next round.

Rounds take about 3½ minutes in total. The edge always closes completely, so every round ends with exactly one winner. If the last balls go out at the same moment, the one nearest the centre wins.

### Page address options

Add these to the game page's address, e.g. `http://localhost:5173/?quick&safe`.

| Option | What it does |
|---|---|
| `layout=landscape` | 1920x1080 landscape layout (the default is 1080x1920 vertical) |
| `safe` | Shades the areas YouTube's phone player usually covers (top bar, buttons on the right, title and chat at the bottom). Use it to check nothing important is hidden. These areas are estimates, so compare with a real Short on your phone. |
| `quick` | Short rounds, for testing |
| `log` | Prints elimination timings to the browser console (for tuning) |
| `debug` | Draws the physics shapes |
| `ws=ws://host:port` | Connect to a server on a different port or machine |

### Only one screen counts

If the game is open in OBS **and** in a browser tab, each runs its own rounds. Only the first one to connect (normally OBS) has its results recorded. The others show **"PREVIEW · results not saved"** in the bottom-left corner. If the first one closes, the next takes over.

---

## 3. Set up YouTube API access (one time, ~15 minutes)

You need this from Stage 3 onward. It lets the server read **your own** stream's chat through YouTube's official API. Nothing is scraped.

### 3a. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and sign in with the Google account that owns your YouTube channel.
2. Click the project picker at the top left, then **New Project**.
3. Name it `name-royale`, click **Create**, and wait a few seconds.
4. Make sure the project picker now shows `name-royale`.

No billing account is needed. The YouTube Data API is free within its daily quota.

### 3b. Turn on the YouTube Data API v3
1. Open the menu (☰), then **APIs & Services → Library**.
2. Search for **YouTube Data API v3**, click it, and click **Enable**.

### 3c. Set up the sign-in screen (OAuth consent)
1. Open the menu (☰), then **APIs & Services → OAuth consent screen**. This page may be called **Google Auth Platform**. Click **Get started**.
2. **App information:** set App name to `Name Royale` and choose your email as the support email. Click **Next**.
3. **Audience:** choose **External** and click **Next**.
4. **Contact information:** enter your email, click **Next**, tick the agreement, and click **Create**.
5. In the left sidebar, click **Audience**. Under **Test users**, click **Add users**, add your own Google account email, and save.
6. In the left sidebar, click **Data Access**, then **Add or remove scopes**. Filter for `youtube.readonly`, tick **`.../auth/youtube.readonly`** ("View your YouTube account"), click **Update**, then **Save**.

   Read-only is all Name Royale needs. It can read chat but it can't post, delete or change anything on your channel.

### 3d. Create the credentials file
1. In the left sidebar, click **Clients** (or **Credentials → Create credentials → OAuth client ID**).
2. Click **Create client**. Set Application type to **Desktop app** and Name to `Name Royale laptop`. Click **Create**.
3. Click **Download JSON**.
4. Rename the downloaded file to exactly `client_secret.json` and move it into `name-royale/secrets/`.
   - **Windows:** File Explorer hides extensions by default, so the file can end up named `client_secret.json.json`. Turn on **View → Show → File name extensions** to check.
5. **Never share this file or commit it to git.** The `secrets/` folder is already ignored by git.

### 3e. Good to know
- **The sign-in expires every 7 days while the app is in "Testing".** That's a Google rule. When it expires, the server opens the sign-in page again. To stop this, go to **Audience** and click **Publish app**. You don't need Google's verification because you're the only user. You'll see a "Google hasn't verified this app" warning when you sign in. Click **Advanced → Go to Name Royale** to continue.
- **Brand channels:** if your channel is a Brand Account, pick the channel (not your personal profile) on the sign-in screen.
- **Daily quota:** new projects get 10,000 units a day, and every chat read uses some. The server tracks usage, logs it, and slows down before hitting the limit. You can see usage at **APIs & Services → YouTube Data API v3 → Quotas & System Limits**. Stage 3 explains this in more detail.

---

## 4. OBS setup

### Add the game as a Browser Source
1. In OBS, under **Sources**, click **+** and choose **Browser**. Name it `Name Royale`.
2. Fill in:

   | Setting | Vertical (9:16, recommended) | Landscape (16:9) |
   |---|---|---|
   | URL | `http://localhost:5173/` | `http://localhost:5173/?layout=landscape` |
   | Width | `1080` | `1920` |
   | Height | `1920` | `1080` |

3. Tick **Use custom frame rate** and set it to `60` (or `30` on an older laptop).
4. Tick **Control audio via OBS**. Game sounds then show up in the OBS Audio Mixer and go out on the stream.
5. **Untick** "Shutdown source when not visible". Otherwise the game stops when you switch scenes.
6. **Untick** "Refresh browser when scene becomes active". Otherwise a refresh wipes the current round.
7. Leave **Custom CSS** as it is and click **OK**.
8. If the game doesn't fill the canvas, right-click it and choose **Transform → Fit to screen**.

Start the server (`npm run sim` or `npm run live`) **before or after** OBS, in either order. The page shows "waiting for server…" in the bottom corner and connects on its own when the server is running.

If you edit the code, right-click the source and choose **Refresh** (Vite usually reloads it automatically).

### OBS video and output settings

| Setting (OBS → Settings) | Recommended |
|---|---|
| **Video → Base and Output resolution** | `1080x1920` for vertical (type it into the box), or `1920x1080` for landscape |
| **Video → FPS** | `60` (use `30` if OBS shows dropped or lagged frames) |
| **Output → Output Mode** | Advanced |
| **Output → Encoder** | Hardware: *NVIDIA NVENC H.264*, *Apple VT H264 Hardware*, *AMD HW H.264* or *QuickSync H.264*. This leaves the processor free for the game. |
| **Output → Rate control** | CBR |
| **Output → Bitrate** | 1080p60: about `6000–9000` Kbps. 1080p30: about `4500–6000` Kbps. Keep it under about 70% of your upload speed (check at speedtest.net). |
| **Output → Keyframe interval** | `2` s |
| **Audio → Sample rate** | 48 kHz. Audio bitrate 128–160 Kbps. |
| **Advanced → Sources** | Keep **Enable Browser Source Hardware Acceleration** ticked |

Use **Stats** (View → Stats) during a test stream. You want 0% dropped and skipped frames.

## 5. YouTube stream settings

In **YouTube Studio → Create → Go live → Stream**:

- **Enable live streaming first.** If it's your first time, YouTube asks you to verify your phone number. It can then take up to 24 hours before you can go live.
- **Audience: "No, it's not made for kids."** Live chat is turned off on streams marked as made for kids, and the game needs chat.
- **Stream latency: Ultra low-latency.** This keeps the delay between a viewer typing `!join` and seeing their ball as short as possible.
- **Live chat: on.** Turn **slow mode** off, or set it to a few seconds at most. Set **participant mode** to "Anyone" so new viewers can join in.
- **Title/description:** say how to play, e.g. *"Type !join in chat to drop your name into the arena!"*
- **Vertical streams (recommended):** set the OBS canvas to 1080x1920. YouTube treats a 9:16 stream as a vertical live stream, which can be shown to viewers in the Shorts feed. Phone viewers see YouTube's buttons and live chat on top of the bottom and right edges of the picture. The vertical layout keeps those areas free of anything important (check with `?safe`). Streaming both layouts at once needs an extra OBS plugin, so start with vertical.

---

## Commands for viewers

| Command | What it does | Limits |
|---|---|---|
| `!join` | Enter the next round | Once per round |
| `!boost` | Small random push on your own ball | Once per round |
| `!colour <name>` (or `!color`) | Pick your ball colour: red, orange, yellow, lime, mint, sky, blue, purple, pink, white. Also understands green, cyan, teal, violet and gold. Your choice is remembered until the game page reloads. | Cooldown |
| `!stats` | Show your wins and rounds played on screen for a few seconds | Cooldown |

All commands are free. Each viewer also has a short general cooldown, so spamming does nothing.

## Configuration

Edit `config/game.config.json` and restart the server. Missing or mistyped settings fall back to the built-in defaults, and the server warns you if the file isn't valid JSON.

| Setting | Default | Meaning |
|---|---|---|
| `round.joinWindowSeconds` | 45 | Time to `!join` before the fight starts |
| `round.winnerScreenSeconds` | 10 | How long the podium shows |
| `round.countdownSeconds` | 5 | Countdown before the next join window |
| `round.maxPlayers` | 60 | Most balls in one round. Extra joiners go into the next round. |
| `arena.shrinkDelaySeconds` | 10 | Fight time before the edge starts shrinking |
| `arena.shrinkDurationSeconds` | 150 | Time for the edge to close completely. This is the longest a fight can last after the delay. Lower it for shorter rounds. |
| `bots.minBalls` | 12 | Every round has at least this many balls. Bots fill the gap. |
| `chaos.minGapSeconds` / `chaos.maxGapSeconds` | 12 / 20 | Random gap between chaos events |
| `commands.perUserCooldownSeconds` | 2 | Minimum gap between any two commands from one viewer |
| `commands.colourCooldownSeconds` | 20 | Cooldown for `!colour` |
| `commands.statsCooldownSeconds` | 30 | Cooldown for `!stats` |
| `commands.boostsPerRound` | 1 | Boosts per viewer per round |
| `server.wsPort` | 8787 | Port the game page uses to reach the server |
| `youtube.dailyQuotaUnits` | 10000 | Your project's daily API quota |
| `youtube.quotaStopFraction` | 0.9 | Stop reading chat at this fraction of the quota |
| `simulator.viewers` | 25 | Number of fake viewers |
| `simulator.messagesPerSecond` | 1.5 | Average rate of fake chat messages |

**Ban list:** add channel IDs or exact display names to `config/banlist.txt`, one per line. Commands from banned viewers are ignored.

**Name filter:** `config/blocked-words.txt` lists words that can't appear in names on screen. A name containing one is shown as `viewer_xxxx` instead. The file explains how matching works. Names are also shortened to 20 characters.

You can edit both files while the server is running. They're re-read within a couple of seconds.

## Project layout

```
name-royale/
├── config/
│   ├── game.config.json   ← settings you can change
│   ├── banlist.txt        ← banned viewers
│   └── blocked-words.txt  ← words not allowed in names on screen
├── data/                  ← leaderboard file (Stage 4). Not in git.
├── secrets/               ← client_secret.json and your sign-in token. Not in git.
├── shared/                ← code used by both the server and the game
│   ├── config.ts          ← settings and their defaults
│   ├── palette.ts         ← the !colour palette
│   └── protocol.ts        ← messages between the server and the game
├── server/                ← Node.js program
│   ├── index.ts           ← start here
│   ├── hub.ts             ← WebSocket connection to the game
│   ├── commands.ts        ← turns chat text into commands, cooldowns
│   ├── moderation.ts      ← ban list and name filter
│   ├── leaderboard.ts     ← wins, rounds and streaks
│   └── sources/           ← where chat comes from
│       ├── simulator.ts   ← fake chat
│       └── youtube.ts     ← real YouTube chat (Stage 3)
├── src/                   ← the game page (runs in OBS)
│   ├── main.ts
│   ├── layout.ts          ← 9:16 and 16:9 screen layouts, and the covered areas
│   ├── net.ts             ← connects to the server, reconnects automatically
│   ├── theme.ts           ← colours and fonts
│   ├── game/
│   │   ├── GameScene.ts   ← the round loop, physics and chaos events
│   │   ├── Ball.ts        ← one player's ball
│   │   ├── bots.ts        ← bot names
│   │   └── paidEvents.ts  ← onSuperChat / onSponsor hooks for later extras
│   └── ui/                ← HUD, leaderboard, feed, pop-ups, podium
└── index.html
```

## npm scripts

| Command | What it does |
|---|---|
| `npm run sim` | Server + game page, with fake chat |
| `npm run live` | Server + game page, with real YouTube chat (Stage 3) |
| `npm run server -- --no-game` | Server only, with no chat source and no game page (for debugging) |
| `npm run game` | Game page only |
| `npm run typecheck` | Check the code for type errors |

## Troubleshooting

- **`Unknown file extension ".ts"`**: your Node.js is too old. Install the current LTS version.
- **`address already in use`**: the server is already running in another terminal. Close that one first.
- **Page says "waiting for server…"**: the server isn't running, or `server.wsPort` was changed. If you change the port, add `?ws=ws://localhost:<port>` to the page URL.
- **OBS shows a blank or black box**: check the URL in a normal browser first. Then right-click the source and choose **Refresh**.
