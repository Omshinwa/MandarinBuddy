MandarinBuddy is a Chinese learning app, built for iOs + web.
It uses a Spaced Repetition flashcards system with an AI chatbot and helper.

<p align="center">
<img src="docs/chat.webp" alt="Chat" width="290" style="max-width: 32%;" />
<img src="docs/review.webp" alt="Review" width="290" style="max-width: 32%;" />
<img src="docs/words.webp" alt="Words" width="290" style="max-width: 32%;" />
</p>

# Tech stack

<p align="center">
  <img src="docs/stack.webp" alt="MandarinBuddy stack" style="max-width: 900px; width: 100%;" />
</p>

One TypeScript codebase, three parts:

- `app/` — Expo (React Native + react-native-web). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Deepseek chat proxy (SSE).
- `shared/` — types and tools used by both.

Words and chat logs live in the same MongoDB (`words` and `chats` collection).

# Features

<p align="center">
  <img src="docs/chat2.webp" alt="Chat" width="290" style="max-width: 32%;" />
  <img src="docs/review2.webp" alt="Review" width="290" style="max-width: 32%;" />
  <img src="docs/review3.webp" alt="Review" width="290" style="max-width: 32%;" />
</p>

Three tabs:

## Chat

AI for conversations, check the existing flashcards and make new ones.

## Review

**Settings**

<p align="center">
  <img src="docs/settings.webp" alt="Settings" width="290" style="max-width: 32%;" />
  <img src="docs/settings2.webp" alt="Settings" width="290" style="max-width: 32%;" />
  <img src="docs/settings3.webp" alt="Settings" width="290" style="max-width: 32%;" />
</p>

</div>

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

| grade                 | trigger                                     | effect                                                  |
| --------------------- | ------------------------------------------- | ------------------------------------------------------- |
| `reviewed_forgot`     | classic review "Forgot"                     | lapse: interval reset, ease −0.2, re-shown this session |
| `reviewed_hard`       | classic review "Hard"                       | interval × 1.2, ease −0.15                              |
| `reviewed_okay`       | classic review "Okay"                       | interval × ease, due pushed out                         |
| `reviewed_easy`       | classic review "Easy"                       | interval × ease × 1.3 (min 4d), ease +0.15              |
| `conversation_used`   | you typed a dictionary word in conversation | small bump on reading+writing (once/word/day)           |
| `conversation_missed` | you tapped a gloss on a word the AI used    | meaning: interval halved, due now                       |

# Game-ification

There are several designs to make the app/language learning process fun. Those techniques incentivizes the user to return to the app without feeling it like an endless chore. A session that ends while the user still feel fine is a session they'll start again tomorrow.

- Snappy UI

The first came for free. Contrary to popular apps like Duolingo, there's very little animations, no mascot, no chest or rewards to open. The time lost between reviews is minimal and the feedback is instant.

- Batch size

Learning sessions are made more digestible by allowing the user to choose the size of the batches. After finishing one batch, the user is met with a Breather Screen.

- Breather screens

Between every batch, there's a congratulation screen (in the form of confettis and fireworks). It doubles as a breather/checkpoint screen. Before that, they were constantly bombarded with words, if they stopped before, they would have to stop while reviewing a flashcard, that specific flashcard's grade wouldn't be saved, so they are incited to keep going until they reach the checkpoint.

# chinese specific
