# Name Royale

A "chat plays" game for YouTube live streams. Viewers type `!join` in live chat and a ball with their name drops into a round arena. The edge slowly shrinks, balls get knocked off, and the last ball left wins.

> **Status: Stage 4 (saved leaderboard).** The game runs with the simulator or your stream's live chat. Wins, rounds, streaks, colour choices and the round number are saved to disk. Next: Stage 5 polish (sound, particles, screen shake).

## Roadmap

- [x] **Stage 1:** project scaffold, this README, server ↔ game connection, fake chat simulator
- [x] **Stage 2:** the game itself (rounds, physics, shrinking arena, bots, podium), driven by the simulator
- [x] **Stage 3:** real YouTube live chat
- [x] **Stage 4:** leaderboard saved to disk, plus ending the show (end card, OBS stop)
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
| `@grpc/grpc-js`, `@grpc/proto-loader` | Connect to YouTube's `streamList` chat stream, which only speaks gRPC. Both are Google's official pure-JavaScript packages, so nothing needs compiling on Windows or Mac. If they ever fail to load, the server polls chat instead. |
| `vite` *(dev)* | Serves the game page to OBS and reloads it instantly while you edit code. |
| `typescript` *(dev)* | Type-checks the code (`npm run typecheck`). It isn't needed to run the game. |
| `@types/node`, `@types/ws` *(dev)* | Type information for the two above. No code runs from these. |

Other YouTube calls use Node's built-in `fetch`, so there's no big Google SDK. Node runs the server's TypeScript files directly, so no build step is needed for the server either.

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
| `end` | End the show (also works in `npm run live`) |
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
- **Daily quota:** new projects get 10,000 units a day, and every chat read uses some. See [Quota](#quota) below.

### 3f. Test it
With `client_secret.json` in place, run:
```
npm run youtube:check
```
The first time, your browser opens Google's sign-in page. Pick the account, or Brand Account, that owns your channel and allow the read-only YouTube permission. The terminal then shows your channel's name.

If you're live while you run it, it also listens to your chat for 20 seconds. Type in your own chat to see the messages appear. A quick way to test without an audience: start an **Unlisted** stream in YouTube Studio, run the check, then end the stream.

---

## Going live with YouTube chat

1. Start your stream in OBS / YouTube Studio as usual.
2. Run:
   ```
   npm run live
   ```
   This starts the server, the game page and the YouTube chat reader. You don't have to go live first. If you're not live yet, the server checks again every minute.
3. You'll see lines like:
   ```
   [youtube] Signed in as channel: Your Channel
   [youtube] Reading chat for "Name Royale – type !join"
   [youtube] Using streamList (live push).
   ```
4. When the stream ends, the server notices and waits for the next one.

**If it picks the wrong stream** (or can't find it), point it at the video directly:
```
npm run live -- --video=https://youtube.com/live/VIDEO_ID
```
or put the ID or URL in `youtube.videoId` in the config.

### How chat is read
- **streamList (default):** YouTube pushes each message to the server the moment it's sent, over one long-lived connection. It's fast and light on quota. YouTube closes the connection now and then. The server reconnects straight away and picks up exactly where it left off.
- **Polling (fallback):** if streaming is refused or fails 3 times within 2 minutes, the server switches to `liveChatMessages.list`, asking for new messages as often as YouTube allows (usually every few seconds). Set `youtube.useStreamList` to `false` to always poll.
- Messages from before the server started are ignored, so old `!join`s don't count. Each message is handled only once, even across reconnects.
- **Super Chats and Super Stickers** call the game's `onSuperChat` hook. **New members** call `onSponsor`. For now these show a thank-you card. A Super Chat whose message starts with `!` (e.g. `!join`) also works as a normal command.

### Quota
Every project gets **10,000 units per day**. The count resets at midnight Pacific time (8am UK time for most of the year). Google doesn't let programs read their live usage, so the server keeps its own **estimate** in `data/quota.json`. It logs the estimate every 10 minutes and at every 10% step:
```
[quota] ~2410 / 10000 units used today (24%, estimate): stream 2380, lookup 30
```
- Above **75%** it switches to slow polling (every 12 s).
- Above **95%** it stops reading chat and **ends the show**: see [Ending the show](#ending-the-show).
- If YouTube itself says the quota is used up, the show ends straight away, whatever the estimate says.
- If you start the server after the quota has already run out that day, the show ends immediately. Wait until 8am UK time.

**Calibrate after your first stream:** compare the estimate with the real number at **Google Cloud Console → APIs & Services → YouTube Data API v3 → Quotas & System Limits**. If they differ, adjust the `youtube.cost*` settings. The defaults are `costListCall` 5, `costStreamOpen` 1, `costStreamResponse` 1 and `costLookup` 1.

Google doesn't clearly document `streamList`'s exact cost. Other developers report roughly 1,500–2,000 units per hour of busy chat, which would mean about 5 hours of streaming a day on the free quota. If you need more, request a quota increase. Search for "YouTube API Services quota extension" in the Google Cloud docs. Google reviews these requests and they take a while.

## Ending the show

Typing `end` into the server's terminal (and pressing Enter) ends the show. So does the YouTube quota running out. Either way:

1. Nobody new can join. If people are still joining, the fight starts straight away with them. If nobody has joined, it skips straight to the end.
2. The current round plays out and the podium shows as normal, so nobody's win gets cut off.
3. A **"Thanks for playing!"** card replaces the next round.
4. After `ending.endCardSeconds` (30 s), the server tells **OBS to stop streaming**.

### Let the server stop OBS (one time, 2 minutes)
OBS 28 and newer has a built-in remote control server:
1. In OBS: **Tools → WebSocket Server Settings**.
2. Tick **Enable WebSocket server**. Leave the port as **4455**.
3. Tick **Enable Authentication**, click **Show Connect Info**, and copy the **Server Password**.
4. Save that password, on its own, in a new text file: `name-royale/secrets/obs-password.txt`.

When you run `npm run live`, the server checks the connection straight away:
```
[obs] Connected to OBS (streaming). It will be stopped automatically when the show ends.
```
If it can't connect, it tells you why, and at the end it will ask you (loudly, in the terminal) to stop the stream yourself.

**Settings:** turn automatic stopping off with `ending.stopObsStream: false`. Set `ending.endShowWhenQuotaRunsOut: false` if you'd rather the game keep running with bots only when the quota runs out.

## The leaderboard file

Everything is saved in `data/leaderboard.json`: each viewer's wins, rounds played, current streak, chosen colour and latest name, plus the next round number. It's saved a second after every round, and again when you stop the server.

- **Backup:** each save also keeps the previous version as `data/leaderboard.backup.json`. If the main file is ever damaged (say, by a power cut mid-save), the server loads the backup instead. It moves the damaged file aside as `leaderboard.unreadable-….json`, never deleting it.
- **Start fresh:** stop the server, then move or delete `data/leaderboard.json` and `data/leaderboard.backup.json`.
- **Fix something by hand:** stop the server first (otherwise your edit will be overwritten), edit the JSON, then start it again.
- **Players are matched by their YouTube channel ID**, so renaming doesn't lose anyone's wins. The board always shows their latest name.
- Bots are never saved. Banned viewers are hidden from the board, and names are re-checked against `blocked-words.txt` whenever the board is shown.
- `!colour` choices are remembered, so a viewer's ball keeps its colour in future streams.

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
| `!colour <name>` (or `!color`) | Pick your ball colour: red, orange, yellow, lime, mint, sky, blue, purple, pink, white. Also understands green, cyan, teal, violet and gold. Your choice is saved and kept for future streams. | Cooldown |
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
| `youtube.videoId` | "" | A specific stream's video ID or URL. Leave empty to find your live stream automatically. |
| `youtube.useStreamList` | true | Use streamList (live push). `false` = always poll. |
| `youtube.minPollSeconds` | 2 | Never poll faster than this |
| `youtube.dailyQuotaUnits` | 10000 | Your project's daily API quota |
| `youtube.quotaSaverFraction` | 0.75 | Switch to slow polling above this fraction of the quota |
| `youtube.saverPollSeconds` | 12 | Poll interval in slow-polling mode |
| `youtube.quotaStopFraction` | 0.95 | Stop reading chat above this fraction of the quota |
| `youtube.costListCall` / `costStreamOpen` / `costStreamResponse` / `costLookup` | 5 / 1 / 1 / 1 | Estimated quota cost of each kind of call. See [Quota](#quota). |
| `ending.endShowWhenQuotaRunsOut` | true | When the YouTube quota runs out, end the show (see [Ending the show](#ending-the-show)) |
| `ending.endCardSeconds` | 30 | How long the "Thanks for playing!" card shows before the stream stops |
| `ending.stopObsStream` | true | Ask OBS to stop streaming at the end |
| `ending.obsWebSocketUrl` | ws://127.0.0.1:4455 | OBS's WebSocket address. The password goes in `secrets/obs-password.txt`. |
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
├── data/                  ← leaderboard.json, its backup, and quota.json. Not in git.
├── secrets/               ← client_secret.json, token.json, obs-password.txt. Not in git.
├── shared/                ← code used by both the server and the game
│   ├── config.ts          ← settings and their defaults
│   ├── palette.ts         ← the !colour palette
│   └── protocol.ts        ← messages between the server and the game
├── server/                ← Node.js program
│   ├── index.ts           ← start here
│   ├── hub.ts             ← WebSocket connection to the game
│   ├── commands.ts        ← turns chat text into commands, cooldowns
│   ├── moderation.ts      ← ban list and name filter
│   ├── leaderboard.ts     ← wins, rounds, streaks and colours, saved to data/
│   ├── ending.ts          ← end-of-show sequence
│   ├── obs.ts             ← tells OBS to stop streaming
│   ├── sources/           ← where chat comes from
│   │   ├── simulator.ts   ← fake chat
│   │   └── youtube.ts     ← real YouTube chat: find stream, stream or poll, quota levels
│   └── youtube/
│       ├── oauth.ts       ← Google sign-in and token refresh
│       ├── api.ts         ← REST calls (channel, broadcast, video, chat polling)
│       ├── stream.ts      ← streamList over gRPC
│       ├── live_chat.proto← the streamList message format
│       ├── messages.ts    ← turns YouTube messages into game events
│       ├── quota.ts       ← daily quota estimate
│       └── check.ts       ← npm run youtube:check
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
├── tests/                 ← npm test (uses fake YouTube servers, no account needed)
└── index.html
```

## npm scripts

| Command | What it does |
|---|---|
| `npm run sim` | Server + game page, with fake chat |
| `npm run live` | Server + game page, with real YouTube chat. Add `-- --video=<id or URL>` to choose the stream. |
| `npm run youtube:check` | Sign in and test your YouTube setup without starting the game |
| `npm test` | Run the automated tests |
| `npm run server -- --no-game` | Server only, with no chat source and no game page (for debugging) |
| `npm run game` | Game page only |
| `npm run typecheck` | Check the code for type errors |

## Troubleshooting

- **`Unknown file extension ".ts"`**: your Node.js is too old. Install the current LTS version.
- **`address already in use`**: the server is already running in another terminal. Close that one first.
- **Page says "waiting for server…"**: the server isn't running, or `server.wsPort` was changed. If you change the port, add `?ws=ws://localhost:<port>` to the page URL.
- **OBS shows a blank or black box**: check the URL in a normal browser first. Then right-click the source and choose **Refresh**.
- **`Missing ...client_secret.json`**: see section 3d. The file must be in `name-royale/secrets/`.
- **`YouTube API error 403 (accessNotConfigured)`**: the YouTube Data API v3 isn't turned on for your project (section 3b).
- **`Error 403: access_denied` in the browser**: your Google account isn't a test user (section 3c, step 5).
- **The sign-in page keeps coming back every week**: that's the 7-day limit in Testing mode (section 3e).
- **"No live stream found"** while you are live: you signed in with a different account or Brand Account than the one streaming. Delete `secrets/token.json` and sign in again, picking the channel. Or use `--video=`.
- **`OBS rejected the password`**: copy the password again from OBS → Tools → WebSocket Server Settings → Show Connect Info into `secrets/obs-password.txt`.
- **`can't reach OBS`**: OBS isn't open, or its WebSocket server isn't enabled (see [Ending the show](#ending-the-show)).
- **Commands are ignored**: check that live chat is on, the stream isn't "made for kids", and the viewer isn't in `config/banlist.txt`. Each viewer also has a short cooldown.
