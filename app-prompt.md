# Build a Chinese-learning app (iOS + web): chat tutor + spaced-repetition flashcards

## Context

This is a ground-up rewrite of an existing personal Chinese-vocabulary web app. The old
codebase is retired; **the only thing that carries over is the data**, which lives in an
existing MongoDB database (connection string will be provided as `MONGODB_URI` in
`server/.env`). The `words` collection currently has documents shaped like:

```js
{
  chinese: String,        // the word/phrase, e.g. "推荐"
  pinyin: String,         // with tone marks
  def_english: String,
  comments: String,       // usually an example sentence
  learn_writing: Boolean, // if true, user wants to practice writing/typing this word
  level_id: Number,       // legacy Leitner level 1–9 — used ONCE for migration, then ignored
}
```

There is also a legacy `progresses` collection (day/step scheduler) — obsolete, ignore it.

Single user, no accounts, no auth. This is a personal tool.

## Goal

A **portrait-phone-first app that runs on iOS and web from one codebase**, with three
bottom tabs: 💬 Chat, 🎴 Review, 📚 Words. Priority #1 is a **simple, clean codebase**.

## Architecture — one monorepo, one language

- `app/` — **Expo (React Native + react-native-web), TypeScript.** The web build of this
  app is also the new website.
- `server/` — small **TypeScript** API server (Hono preferred; Express-in-TS acceptable).
  Talks to MongoDB and proxies the Claude API. Target: a few hundred clean lines.
- `shared/` — TypeScript types shared by both (`Word`, `Srs`, grade names, API payloads).
- Secrets (`MONGODB_URI`, `ANTHROPIC_API_KEY`) live in `server/.env` and **never reach
  the client**. The app talks only to our server.

## SRS model — timestamp scheduling (Anki/SM-2 style, not levels)

A Chinese word is three-dimensional (writing, meaning, pronunciation — pronunciation
cannot be derived from the writing), so it is tested in **three independent directions**.
These are separate memories and each gets its own SRS state (Anki's note-vs-cards model):

| direction | prompt → answer | how it's checked |
|---|---|---|
| `meaning` | hanzi → English | flip card, self-graded (Remembered / Forgot) |
| `reading` | hanzi → pinyin | user types the pinyin, auto-checked |
| `writing` | English → hanzi | user enters the hanzi, auto-checked. All words are tested; `learn_writing` only controls *how* (see Classic review) |

```ts
type Srs = {
  due: Date;            // when this direction should next be reviewed (default: now)
  intervalDays: number; // current gap between reviews (default 0)
  ease: number;         // per-direction growth multiplier, default 2.5, floor 1.3
  lapses: number;       // times forgotten after being learned
};

// on each word:
srs: {
  meaning: Srs;
  reading: Srs;
  writing: Srs;
}
```

The review queue is: all **(word, direction) pairs** with `due <= now`, weakest
(shortest interval) first. **Bury siblings:** never test more than one direction of the
same word in the same session — the other directions wait for the next session even if
due. Implement scheduling as **one pure, unit-tested function**
`applyGrade(srs, grade, now): Srs` operating on a single direction's state — all tuning
constants in one place at the top of that file. Grades:

| grade | source | effect |
|---|---|---|
| `reviewed_remembered` | classic review | `interval = max(1, interval × ease)`; `due = now + interval` |
| `reviewed_forgot` | classic review | `lapses++`; `ease = max(1.3, ease − 0.2)`; `interval = 0`; `due = now` (re-shown this session) |
| `conversation_used` | user produced the word in AI conversation | partial credit: `interval = min(interval × 1.3, interval + 15)`; push `due` accordingly; **max one credit per word per day** |
| `conversation_missed` | user tapped the gloss on a word the AI used | soft lapse: `interval = interval / 2`; `due = now`; no ease penalty |

Classic grades apply to whichever direction is being tested. Conversation grades map to
directions: `conversation_used` credits `reading` and `writing` (typing a word through a
pinyin IME demonstrates pronunciation + character choice); `conversation_missed`
penalizes `meaning` (the user saw the hanzi and didn't know it).

**One-time migration script** (`server/scripts/migrate-srs.ts`): map legacy `level_id`
to starting intervals — 1→0d (due now), 2→1d, 3→3d, 4→7d, 5→14d, 6→30d, 7→60d, 8→90d,
9→180d. Seed all three directions with that interval, staggering `due` by +0/+1/+2 days per direction so
migrated words don't all triple-hit the first session. Leave `level_id` in place but
never read or write it again after migration.

For UI color-coding, bucket words by current interval (reuse roughly: <1d, 1–3d, 3–7d,
7–14d, 14–30d, 30–90d, >90d) — a small pure helper `intervalBucket(days)`.

## Server API

1. Words REST:
   - `GET /api/words?due=true&search=` — list/filter (`due=true` → `srs.due <= now`)
   - `POST /api/words` — create (srs defaults: due now); reject exact-duplicate `chinese`
   - `PUT /api/words/:id`, `DELETE /api/words/:id`
   - `POST /api/review/grade` — body `{wordId, direction, grade}`; applies `applyGrade`
     to that direction's state, saves, returns the updated word
2. `POST /api/chat` — **streaming proxy to the Claude API** using `@anthropic-ai/sdk`.
   Model `claude-opus-4-8`, `client.messages.stream(...)`, forwarded to the app via SSE.
   Two chat modes share this endpoint (a `mode` field selects the system prompt):
   `assistant` (Tab 1) and `conversation` (Tab 2). Persist chat history in MongoDB.
3. In `conversation` mode, on every user message the server substring-matches the
   message text against all dictionary `chinese` values; each match fires
   `conversation_used` (respecting the once-per-word-per-day cap). Note: Chinese has no
   spaces, so this is substring matching; the daily cap limits over-crediting of short
   words. (If it ever needs improving, a segmentation library like jieba is the upgrade
   path — do not add it now.)

## Tab 1 — Chat (language assistant)

ChatGPT-style conversation UI: bubbles, streaming text, input bar pinned above the
keyboard, history persisted and restored.

- System prompt: the assistant is a Chinese-language tutor and only answers
  language-related questions (translations, grammar, usage, example sentences). A bare
  word or phrase (e.g. `推荐`) gets meaning + pinyin + one example sentence. Put
  `cache_control: {type: "ephemeral"}` on the system prompt block.
- Define this tool; the model calls it whenever a word is worth saving:

  ```json
  {
    "name": "propose_flashcard",
    "description": "Propose a flashcard for a Chinese word or phrase the user is learning. Call this whenever the user asks about a specific word/phrase, so they can save it with one tap.",
    "strict": true,
    "input_schema": {
      "type": "object",
      "properties": {
        "chinese": {"type": "string"},
        "pinyin": {"type": "string", "description": "with tone marks"},
        "english": {"type": "string"},
        "example": {"type": "string", "description": "short example sentence with pinyin and translation"}
      },
      "required": ["chinese", "pinyin", "english", "example"],
      "additionalProperties": false
    }
  }
  ```

  When the model calls it, don't execute anything server-side — forward the structured
  input over the SSE stream to the app, which renders an inline card preview with
  **Add / Dismiss** buttons. **Add** lets the user edit the fields, then POSTs to
  `/api/words` (`english → def_english`, `example → comments`). If the word already
  exists in the dictionary, show that instead of Add. Return a tool_result like
  "card shown to user" and let the model finish its turn. Use the SDK's parsed
  `input` object — never string-match raw JSON.

## Tab 2 — Review

Mode picker at the top: **Classic** and **Conversation**.

### Classic (no AI; works offline once words are loaded)

- Queue: due (word, direction) pairs, weakest first, siblings buried; show remaining
  count and a small badge for the direction under test (🧠 meaning / 🗣️ reading /
  ✍️ writing).
- **meaning** (hanzi → English): front shows the Chinese, large type, tap to hear TTS.
  Flip reveals pinyin + English + comments. Buttons **Remembered / Forgot** →
  `POST /api/review/grade`.
- **reading** (hanzi → pinyin): front shows the Chinese only — no TTS button until
  answered (it would give the answer away). User types the pinyin; auto-check against
  the stored pinyin, accepting tone marks or tone numbers (`tuījiàn` / `tui1jian4`),
  case- and whitespace-insensitive, with a setting for whether tones are required.
  Correct → `reviewed_remembered`; wrong → `reviewed_forgot`, reveal the answer and
  play TTS.
- **writing** (English → hanzi): front shows the English, with comments available as a
  hint toggle. User enters the Chinese; exact match against `chinese` →
  `reviewed_remembered`, else `reviewed_forgot` with reveal. `learn_writing` controls
  the input-method expectation, mirroring the old app: if true, show a ✍️ "write the
  strokes by hand" badge (the user switches to the iOS Chinese handwriting keyboard);
  if false, pinyin IME typing is fine. The app cannot enforce which keyboard is used —
  the badge is an honor-system hint. (Possible future upgrade, do NOT build now: an
  in-app stroke canvas, e.g. Hanzi Writer, which would also work on web.)
- Color-code by the tested direction's interval bucket.

### Conversation (AI)

- Claude chats **in Chinese** at the learner's level, deliberately weaving in the user's
  vocabulary. The server builds the system prompt: include the vocab list
  (chinese + pinyin + english) with `cache_control` on that block. **If the dictionary
  exceeds ~500 words, send only the due + short-interval words plus a random sample of
  the rest, resampled once per day** (daily resampling keeps the cached prompt stable
  within a day).
- Instruct the model to: prefer due/weak words, keep sentences short and level-
  appropriate, gently correct the user's Chinese mistakes.
- Render every dictionary word inside AI messages as **highlighted and tappable**.
  Tapping reveals the gloss (pinyin + English) AND fires `conversation_missed` for that
  word's `meaning` direction (once per word per session).
- Words the user types that match the dictionary earn `conversation_used` credit on
  their `reading` and `writing` directions (server-side, see Server API #3).
- `propose_flashcard` is available in this mode too, for new words that come up.
- This mode is a real part of the SRS: the two conversation grades above are the only
  way it touches scheduling.

## Tab 3 — Words (manage)

- Searchable list of all words; filter chips by interval bucket (same colors, using the
  word's weakest direction); sort by next-due or recently added; each row shows the
  word, gloss, and soonest next-due across its directions.
- Tap a word → edit sheet: all fields; per-direction SRS state visible;
  `learn_writing` toggle (controls the handwriting badge on writing cards); a
  "reset progress" button (zeroes all directions); delete with confirmation.
- "+" button for manual card creation.

## Voice (build in this order — all phone-native, no extra AI services)

1. **TTS now:** every Chinese text (card fronts, AI messages) has a play button —
   `expo-speech` with a `zh-CN` voice on iOS, `speechSynthesis` on web.
2. **STT next:** mic button on the conversation input that dictates Mandarin speech to
   text (`expo-speech-recognition` on native; `webkitSpeechRecognition` on web).
3. **Hands-free mode later:** in Conversation review, auto-read each AI reply aloud and
   auto-open the mic when playback ends. Structure the chat code so speech in/out is a
   thin wrapper around the existing text pipeline, not a fork of it.

## Design constraints

- Portrait phone first; respect iOS safe areas; bottom tab bar (💬 Chat, 🎴 Review,
  📚 Words).
- Large, readable Chinese type; dark and light mode.
- The web build (`npx expo export --platform web`) must work — every native API needs a
  web fallback.
- Keep it simple: no state-management library unless clearly needed, no premature
  abstractions, tuning constants centralized in `applyGrade`'s file.

## Build order (commit after each step; verify each end-to-end against the real server before moving on)

1. Monorepo scaffold (`app/`, `server/`, `shared/`); `applyGrade` with unit tests;
   migration script (run against the real DB only after tests pass — it's additive and
   idempotent); words REST endpoints.
2. Expo scaffold + bottom tabs + typed API client.
3. Words tab: full CRUD against real data.
4. Classic review: all three direction checks (meaning flip, pinyin input with
   normalization, hanzi input), sibling burying, TTS play buttons.
5. `/api/chat` streaming proxy + Chat tab with the `propose_flashcard` flow.
6. Conversation review mode: vocab-aware system prompt, tappable glosses, usage credit.
7. STT mic button, then hands-free mode; polish (haptics, card-flip animation,
   offline/error states).
