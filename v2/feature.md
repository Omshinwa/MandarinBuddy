# SuperAnki v2 — Features

Chinese vocab app: React Native (Expo SDK 54, iOS + web) · Hono + MongoDB server · shared TS package for SRS logic (unit-tested with vitest).

## 💬 AI Chat — tutor + conversation partner (one thread)

- DeepSeek (`deepseek-chat`, OpenAI-compatible API) streamed over **SSE**; a single system prompt covers both roles (word lookups vs Chinese small talk).
- **Tools** the model can call:
  - `propose_flashcard` — renders a one-tap card: compact "✓ Add 频率 card?" button → expands to an editable preview → saves to the deck.
  - `lookup_card` — regex search of the real deck (hanzi/pinyin/English) so "do I already have X?" is never guessed.
  - `set_review_mode` — flips the app's review toggle from a natural-language request (via an SSE event).
- **Vocab in the prompt**: up to 500 deck words as `汉字 — gloss [weak]`, weakest/most-overdue first; pinyin omitted to save tokens; deterministic daily shuffle keeps the prompt cache-stable.
- **SRS ↔ chat integration**: dictionary words in AI messages are highlighted — tap to reveal the gloss (counts as `conversation_missed`); words *you* produce correctly earn `conversation_used` credit (once per word per day).
- Markdown `**bold**` / `*italic*` rendered; bubbles are selectable (long-press to copy).
- **Review session** banner: AI drills weak/due words conversationally, corrects mistakes inline.

## 🗣️ Voice

- **TTS**: Google Translate's public Mandarin voice (`translate_tts`), **proxied through the server** at `/api/tts` (browsers block the cross-site load; the server fetches and streams `audio/mpeg` back, cached 24h). Same path on phone and web.
  - ≤200 chars (endpoint limit); longer text falls back to the device voice (`expo-speech`, zh-CN). Native also falls back if playback hasn't started after 2.5s.
  - Plays through the iPhone silent switch (`playsInSilentMode`).
- **Auto-read** (📢 toggle, persisted): every completed AI reply is spoken; emphasis markers stripped first.
- **Dictation** (🎤): free Web Speech API (`zh-CN`), transcript fills the input live; renders only where the API exists (desktop Chrome/Edge — not iOS/WebKit).

## 🧠 SRS — one card, one clock, weighted facets

- **One schedule per word** (Anki-style: interval × ease, grades Forgot/Hard/Okay/Easy with next-interval previews on the buttons; leech suspension after 8 lapses, reactivatable).
- **Three question facets** (meaning / reading / writing) share the clock but track their own `strength` (mastery 0–8) and `asked` (rotation counter). Queue picks per card: `score = asked + 2·strength`, lowest wins → **the weakest facet is asked most often, strong ones still resurface**. Failing a facet re-drills *that* facet; mastered ones aren't re-tested to prop it up.
- Writing is asked on every card; `learn_writing` only switches the hint (✍️ handwrite strokes vs ⌨️ type via pinyin keyboard).
- **Scaffolding**: interval < 14d → pinyin shown + audio auto-played; mature cards must be answered from characters alone. Answers are always spoken.
- Typed answers checked: pinyin with tones (**fuzzy toggle**: 2nd/3rd tone interchangeable) or exact hanzi.
- Legacy 3-schedule data was merged in-place; every word keeps its pre-merge state in `srs_legacy` for rollback.

## 🎉 Review gamification

- Background hue rotates + saturation ramps with every correct answer (random start hue per session; lightness fixed for readability).
- Milestone takeover every 25 correct answers — escalating tiers: 25 colorful → 50 crazier → 100 craziest (confetti count/speed, rainbow cycle, haptics).
- Forgot → card requeues within the session (unless it just became a leech).

## 📚 Words screen

- Search + color-coded interval buckets (palette carried over from the old site) + 🐢 leech filter.
- Per-word: schedule (interval/ease/lapses) + per-facet mastery readout, edit/reset/reactivate/delete.

## ⚙️ Plumbing worth knowing

- `shared/` package: SRS algorithm + types used by both app and server, 37 unit tests.
- Grades are saved per answer (`POST /api/review/grade`); failures surface in the UI instead of silently dropping progress.
- Chat history persists in Mongo (last 30 turns sent as context); DeepSeek context caching is automatic.
