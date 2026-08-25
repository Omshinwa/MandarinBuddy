MandarinBuddy is a Chinese learning app, built for iOs + web.
It uses a Spaced Repetition flashcards system with an AI chatbot and helper.

<p align="center">
<img src="docs/chat.webp" alt="Chat" height="450"/>
<img src="docs/review.webp" alt="Review" height="450"/>
<img src="docs/words.webp" alt="Words" height="450"/>
<img src="docs/settings.webp" alt="Settings" height="450"/>
</p>

# Tech stack

<p align="center">
  <img src="docs/stack.webp" alt="MandarinBuddy stack" style="max-width: 800px; width: 100%;" />
</p>

One TypeScript codebase, three parts:

- `app/` — Expo (React Native + react-native-web). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Deepseek chat proxy (SSE).
- `shared/` — types and tools used by both.

Words and chat logs live in the same MongoDB (`words` and `chats` collection).

# Features

Three main tabs: Chat, Review, Words.

## Chat

<img src="docs/chat2.webp" alt="Chat" height="450" align="left" />

**Assistant AI**: Conversational and Utility caller. DeepSeek (`deepseek-chat`, OpenAI-compatible API) streamed over **SSE**. Ability to lookup existing flashcards or create new ones. A single system prompt covers both roles.

**Vocab in the prompt**: words from the deck are supplied so the AI can target them.

**SRS ↔ chat integration**: dictionary words in messages are highlighted — tap it to show its definition inline (counts as `conversation_missed`); words the user produce correctly earn `conversation_used` credit.

<br clear="both" />

## Review

<img src="docs/review3.webp" alt="Review" height="450" align="left"/>
<img src="docs/review2.webp" alt="Review" height="450" align="left" />

**Review**: due words, scheduled by SRS. Two modes: Direct typing input, or just flip the card.

**Three Aspects**: for each word, Meaning, Reading and Writing.

<br clear="both" />

## 📚 Words screen

<img src="docs/words2.webp" alt="Review" height="450" align="left"/>

- CRUD (create, read, update, delete) the words
- Search + color-coded interval buckets.
- Per-word: schedule (interval/ease/lapses) + per-facet mastery readout

<br clear="both" />

## Run it

**Server** (terminal 1):

```sh
cd server
npm install
npm start          # http://localhost:6767
```

`server/.env` needs `MONGODB_URI` and `DEEPSEEK_API_KEY`
(required for the Chat tab; words/review work without it). 

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
cd server && npm run dev
launch the app
cd app && npm start
```

### env vars (server/.env — see .env.example)

```
MONGODB_URI - DB access
DEEPSEEK_API_KEY -
APP_PASSWORD — optional gate
```

## Test on phone

Install **Expo Go** from the App Store / Play Store, then run `./launch.sh` (or
`cd app && npm start`) and scan the QR code with your phone (same Wi-Fi as
your Mac). If it won't connect, use `./launch-tunnel.sh`.


# Game-ification

There are several designs to make the app/language learning process fun. Those techniques incentivizes the user to return to the app without feeling it like an endless chore. A session that ends while the user still feel fine is a session they'll start again tomorrow.

- Snappy UI

The first came for free. Contrary to popular apps like Duolingo, there's very little animations, no mascot, no chest or rewards to open. The time lost between reviews is minimal and the feedback is instant.

- Batch size

Learning sessions are made more digestible by allowing the user to choose the size of the batches. After finishing one batch, the user is met with a Breather Screen.

- Breather screens

Between every batch, there's a congratulation screen (in the form of confettis and fireworks). It doubles as a breather/checkpoint screen. Before that, they were constantly bombarded with words, if they stopped before, they would have to stop while reviewing a flashcard, that specific flashcard's grade wouldn't be saved, so they are incited to keep going until they reach the checkpoint.

# chinese specific
