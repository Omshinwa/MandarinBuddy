# SuperAnki v2 — Chinese learning app (iOS + web)

Ground-up rewrite of the old site. One TypeScript codebase, three parts:

- `app/` — Expo (React Native + react-native-web). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Claude chat proxy (SSE).
- `shared/` — types + the pure SRS scheduler (`applyGrade`) + pinyin matcher, used by both.

Words live in the same MongoDB as the old site (`words` collection). The migration
added per-direction SRS state (`srs.meaning` / `srs.reading` / `srs.writing`) to every
word; the legacy `level_id` is kept but no longer used.

## Run it

**Server** (terminal 1):

```sh
cd server
npm install
npm start          # http://localhost:6767
```

`server/.env` needs `MONGODB_URI` (already set) and `DEEPSEEK_API_KEY`
(platform.deepseek.com — required only for the two chat modes; words/review
work without it). Chat runs on DeepSeek's OpenAI-compatible API
(`deepseek-chat`); the previous Claude implementation is preserved in
`server/src/routes/chat_claude.old` if you ever want to switch back.

**App** (terminal 2):

```sh
cd app
npm install
npm start          # then: press w for web, or scan the QR with Expo Go on iPhone
```

On the phone, the app auto-targets port 6767 on the same machine as the Metro
bundler — no config needed on the same WiFi. To point elsewhere, set
`EXPO_PUBLIC_API_URL=https://your-server` when starting.

## Tests / checks

```sh
cd server && npm test        # SRS scheduler + pinyin matcher unit tests
cd server && npm run typecheck
cd app && npm run typecheck
cd app && npm run export:web # static site in app/dist — deployable anywhere
```

## How scheduling works

Each word has three independent SRS states (meaning / reading / writing), each with
`{due, intervalDays, ease, lapses}` — Anki's SM-2 style. All tuning constants are in
`shared/src/srs.ts` (`TUNING`). Grades:

| grade | trigger | effect |
|---|---|---|
| `reviewed_forgot` | classic review "Forgot" | lapse: interval reset, ease −0.2, re-shown this session |
| `reviewed_hard` | classic review "Hard" | interval × 1.2, ease −0.15 |
| `reviewed_remembered` | classic review "Okay" | interval × ease, due pushed out |
| `reviewed_easy` | classic review "Easy" | interval × ease × 1.3 (min 4d), ease +0.15 |
| `conversation_used` | you typed a dictionary word in conversation | small bump on reading+writing (once/word/day) |
| `conversation_missed` | you tapped a gloss on a word the AI used | meaning: interval halved, due now |

The review queue serves one direction per word per session (sibling burying).

## Migration

`server/scripts/migrate-srs.ts` (already run — 1555 words). Additive and idempotent:
only touches words without `srs`, mapping legacy levels 1–9 → starting intervals of
0/1/3/7/14/30/60/90/180 days, staggered +0/+1/+2 days across directions.
