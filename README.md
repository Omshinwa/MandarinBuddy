MandarinBuddy is a Chinese learning app, built for iOS + web. It was built for personal use (there's a single password protection).
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
- [Chinese-targeted features](#chinese-targeted-features)
- [Settings](#settings)
- [License](#license)

# Tech stack

<p align="center">
  <img src="docs/stack.webp" alt="MandarinBuddy stack" style="max-width: 800px; width: 100%;" />
</p>

One TypeScript codebase:

- `app/` — Expo (React Native). The iPhone app **and** the website.
- `server/` — small Hono API: words CRUD, SRS review grading, Deepseek chat proxy (SSE).
- `shared/` — types and tools used by both.
- `old/` — old 2018 version of the project in pure HTML and JS, kept only for legacy reasons

Words and chat logs live in the same MongoDB (`words` and `chats` collections).

# Features

Three main tabs: Chat, Review, Words.

## 💬 Chat screen

<img src="docs/chat.webp" alt="Chat" height="450" align="left" />
<img src="docs/chat2.webp" alt="Chat" height="450" align="left" />

**Assistant AI**: chats with you and can call tools to look up or create flashcards. DeepSeek (`deepseek-chat`, OpenAI-compatible API) streamed over **SSE**. A single system prompt covers both roles.

**Vocab in the prompt**: words from the deck are supplied so the AI can target them.

**SRS ↔ chat integration**: dictionary words in messages are highlighted — tap one to show its definition inline (counts as `conversation_missed`); words the user produces correctly earn `conversation_used` credit.

**Dictation** (🎤): free Web Speech API, web build only.

<br clear="both" />

## 🔁 Review screen

<img src="docs/review3.webp" alt="Review" height="450" align="left"/>
<img src="docs/review2.webp" alt="Review" height="450" align="left" />

**Three Aspects**: for each word, Meaning, Reading and Writing.

**Review**: due words, scheduled by SRS. Two modes: **Direct typed input** or **Flip the card** (this is set per aspect in the Settings). There's also the option to **Both**, where a word starts as a _flip card_ then switches to _typed input_ once it's familiar enough.

**Auto-read**: words are read by default using Google Translate's public voice, proxied through the server at `/api/tts`. Chat messages are also read this way. Falls back to the device voice (`expo-speech`).

**Scaffold learning**: young cards come with training wheels. The threshold is configurable in Settings. Some hints are then given. Once the card mature, those aids are dropped.

<br clear="both" />

## 📚 Words screen

<img src="docs/words.webp" alt="Words" height="450" align="left"/>
<img src="docs/words2.webp" alt="Words" height="450" align="left"/>

- **CRUD** (create, read, update, delete) the words
- **Search** + color-coded interval buckets.
  **Scheduling**: Each word has its own schedule. It's a SM-2 variant (Anki-style): ease, intervals, lapses and failures. + stats to track each facets (meaning, reading, writing) mastery.

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

There are several designs to make the app/language learning process fun. Incentivizing the user to return to the app without it feeling like a chore:

**Snappy UI**: this first came for free. Contrary to apps like Duolingo, there are no animations, no mascot, no chest or rewards to open. The time lost between reviews is minimal and the feedback is instant.

**Batch Size**: learning sessions are made more digestible by allowing the user to choose the size of the batches (in the settings). After finishing one batch, the user is met with a Breather Screen.

**Breather Screen**: between every batch, there's a congratulation screen (in the form of confetti and fireworks). It doubles as a breather/checkpoint screen. Before that, they were constantly bombarded with words, if they stopped before, they would have to stop while reviewing a flashcard, that specific flashcard's grade wouldn't be saved, so they are incited to keep going until they reach the checkpoint.

# Chinese-targeted features

**Reading**: Unlike languages such as Spanish, Chinese words doesn't indicate pronunciation. So besides the classic Meaning and Writing, Reading is tested too, by having the user type pinyin.

**Practice Handwriting**: Some characters are very complex to learn how to handwrite (建筑), others are easy and worth the trouble (水). A per-word toggle marks which ones should be written with strokes rather than pinyin. It's a visual cue only — nothing is enforced, and you type with the device keyboard, so you need a Chinese keyboard installed.

**Fuzzy Pinyin**: Makes Reading tests more lenient (the second and third tones are combined). Toggable in the settings.

# Settings

<p align="center">
<img src="docs/settings.webp" alt="Settings" height="450"/>
<img src="docs/settings2.webp" alt="Settings" height="450"/>
<img src="docs/settings3.webp" alt="Settings" height="450"/>
</p>
