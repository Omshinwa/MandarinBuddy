MandarinBuddy is a Chinese learning app, built for iOs + web. It was built for personal use (there's a single password protection).
It uses a Spaced Repetition flashcards system with an AI chatbot and helper.

<p align="center">
<img src="docs/chat.webp" alt="Chat" height="450"/>
<img src="docs/review.webp" alt="Review" height="450"/>
<img src="docs/words.webp" alt="Words" height="450"/>
<img src="docs/settings.webp" alt="Settings" height="450"/>
</p>

## Contents

- [Tech stack](#tech-stack)
- [Features](#features)
  - [💬 Chat screen](#-chat-screen)
  - [🔁 Review screen](#-review-screen)
  - [📚 Words screen](#-words-screen)
- [Run it](#run-it)
- [Game-ification](#game-ification)

# Tech stack

<p align="center">
  <img src="docs/stack.webp" alt="MandarinBuddy stack" style="max-width: 800px; width: 100%;" />
</p>

One TypeScript codebase, three parts:

- `app/` — Expo (React Native). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Deepseek chat proxy (SSE).
- `shared/` — types and tools used by both.

- `old/` — old 2018 version of the project in pure JS, kept only for legacy reasons

Words and chat logs live in the same MongoDB (`words` and `chats` collection).

# Features

Three main tabs: Chat, Review, Words.

## 💬 Chat screen

<img src="docs/chat.webp" alt="Chat" height="450" align="left" />
<img src="docs/chat2.webp" alt="Chat" height="450" align="left" />

**Assistant AI**: Conversational and Utility caller. DeepSeek (`deepseek-chat`, OpenAI-compatible API) streamed over **SSE**. Ability to lookup existing flashcards or create new ones. A single system prompt covers both roles.

**Vocab in the prompt**: words from the deck are supplied so the AI can target them.

**SRS ↔ chat integration**: dictionary words in messages are highlighted — tap it to show its definition inline (counts as `conversation_missed`); words the user produce correctly earn `conversation_used` credit.

**Dictation** (🎤): free Web Speech API, web build only.

<br clear="both" />

## 🔁 Review screen

<img src="docs/review3.webp" alt="Review" height="450" align="left"/>
<img src="docs/review2.webp" alt="Review" height="450" align="left" />

**Review**: due words, scheduled by SRS. Two modes: Direct typing input, or just flip the card.

**Three Aspects**: for each word, Meaning, Reading and Writing.

**Auto-read**: word are read by default using Google Translate's public voice, proxied through the server at `/api/tts`. Chat messages are also read this way. Falls back to the device voice (`expo-speech`).

<br clear="both" />

## 📚 Words screen

<img src="docs/words.webp" alt="Review" height="450" align="left"/>
<img src="docs/words2.webp" alt="Review" height="450" align="left"/>

- **CRUD** (create, read, update, delete) the words
- **Search** + color-coded interval buckets.
- Per-word: schedule (interval/ease/lapses) + per-facet mastery readout

<br clear="both" />

# Run it

**Server** (terminal 1):

```sh
cd server
npm install
npm run dev          # http://localhost:6767
```

`server/.env` needs `MONGODB_URI` and `DEEPSEEK_API_KEY`
(required for the Chat tab; words/review work without it). (see server/.env.example)

**App** (terminal 2):

```sh
cd app
npm install
npm start          # then: press w for web, or scan the QR with Expo Go on iPhone
```

On the phone, the app auto-targets port 6767 on the same machine as the Metro
bundler — no config needed on the same WiFi. To point elsewhere, set
`EXPO_PUBLIC_API_URL=https://your-server` when starting.

# Game-ification

<img src="docs/review4.webp" alt="Review" height="450" align="left" />

There are several designs to make the app/language learning process fun. Incentivizing the user to return to the app without feeling it like a chore:

**Snappy UI**: this first came for free. Contrary to apps like Duolingo, there's very no animations, no mascot, no chest or rewards to open. The time lost between reviews is minimal and the feedback is instant.

**Batch size**: learning sessions are made more digestible by allowing the user to choose the size of the batches (in the settings). After finishing one batch, the user is met with a Breather Screen.

**Breather screens**: between every batch, there's a congratulation screen (in the form of confettis and fireworks). It doubles as a breather/checkpoint screen. Before that, they were constantly bombarded with words, if they stopped before, they would have to stop while reviewing a flashcard, that specific flashcard's grade wouldn't be saved, so they are incited to keep going until they reach the checkpoint.
