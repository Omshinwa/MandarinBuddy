# MandarinBuddy v2 — Chinese learning app (iOS + web)

One TypeScript codebase, three parts:

- `app/` — Expo (React Native + react-native-web). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Claude chat proxy (SSE).
- `shared/` — types + the pure SRS scheduler (`applyGrade`) + pinyin matcher, used by both.

Words live in the same MongoDB (`words` collection).

## Run it

**Server** (terminal 1):

```sh
cd server
npm install
npm start          # http://localhost:6767
```

`server/.env` needs `MONGODB_URI` and `DEEPSEEK_API_KEY`
(platform.deepseek.com — required only for the Chat tab; words/review
work without it). Chat runs on DeepSeek's OpenAI-compatible API
(`deepseek-chat`).

**App** (terminal 2):

```sh
cd app
npm install
npm start          # then: press w for web, or scan the QR with Expo Go on iPhone
```

On the phone, the app auto-targets port 6767 on the same machine as the Metro
bundler — no config needed on the same WiFi. To point elsewhere, set
`EXPO_PUBLIC_API_URL=https://your-server` when starting.


### one-command launch (from the repo root)
- `./launch.sh` — normal case: backend + Expo over the LAN. Extra args pass
  through to expo (`./launch.sh --web`, `--ios`, `-c`).
- `./launch-tunnel.sh` — when the phone can't reach this machine over the LAN
  (Wi-Fi client isolation, VPN, NAT). Puts the backend behind a cloudflared
  public URL and Expo behind its own tunnel. Slower, and the URL changes each run.

### or launch the two halves by hand
```sh
launch the server
cd v2/server && npm run dev
launch the app
cd v2/app && npm start
```

### env vars (server/.env — see .env.example)
- MONGODB_URI — the v2 server uses this name, NOT the old site's ATLAS_URI
- DEEPSEEK_API_KEY — powers the chat/tutor
- APP_PASSWORD — optional write gate (above)

### server: `npm run dev` vs `npm start`
- `npm run dev` = `tsx watch` — auto-restarts when you edit server code. use this while developing.
- `npm start` = `tsx` (no watch) — loads the code once and holds it in memory. if you edit server code you MUST ctrl-c and relaunch
- either way, `.env` (e.g. MONGODB_URI) is read only at boot — changing it needs a manual restart.

## test on phone
Install **Expo Go** from the App Store / Play Store, then run `./launch.sh` (or
`cd v2/app && npm start`) and scan the QR code with your phone (same Wi-Fi as
your Mac). If it won't connect, use `./launch-tunnel.sh`.


## How scheduling works

Each word has **one** SRS state — `{due, intervalDays, ease, lapses}`, Anki's SM-2
style. When the card comes due, the facet picker in `shared/src/srs.ts` chooses which
of the three facets (meaning / reading / writing) to ask, based on per-facet
`facets: {strength, asked}` — weakest facet most often, stronger ones still revisited.
All tuning constants are in `shared/src/srs.ts` (`TUNING`). Grades:

| grade | trigger | effect |
|---|---|---|
| `reviewed_forgot` | classic review "Forgot" | lapse: interval reset, ease −0.2, re-shown this session |
| `reviewed_hard` | classic review "Hard" | interval × 1.2, ease −0.15 |
| `reviewed_okay` | classic review "Okay" | interval × ease, due pushed out |
| `reviewed_easy` | classic review "Easy" | interval × ease × 1.3 (min 4d), ease +0.15 |
| `conversation_used` | you typed a dictionary word in conversation | small bump on reading+writing (once/word/day) |
| `conversation_missed` | you tapped a gloss on a word the AI used | meaning: interval halved, due now |