import type { WordDoc } from "./db";

export const PROPOSE_FLASHCARD_TOOL = {
  name: "propose_flashcard",
  description:
    "Propose a flashcard for a Chinese word/phrase the user is learning. Call it whenever a specific word comes up — including when the user just sends a bare word to learn — so they can save it with one tap. If the word is already in their deck, the app reports that back instead of showing a duplicate, so you can call it freely.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      chinese: { type: "string" },
      pinyin: { type: "string", description: "with tone marks" },
      english: { type: "string" },
      example: {
        type: "string",
        description: "short example sentence with pinyin and translation",
      },
    },
    required: ["chinese", "pinyin", "english", "example"],
    additionalProperties: false,
  },
};

export const LOOKUP_CARD_TOOL = {
  name: "lookup_card",
  description:
    "Search the user's saved flashcard deck to check whether a word/phrase is already a card. Call this before telling the user whether they've already saved something, or when they ask what is in their deck. Never guess — always look it up.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "The word or phrase to search for — Chinese characters, pinyin, or the English meaning.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const SET_REVIEW_MODE_TOOL = {
  name: "set_review_mode",
  description:
    "Turn the user's review session on or off. Call it when the user asks to start reviewing/practicing their words (on: true) or asks to stop (on: false), so the app's review indicator matches what you are doing.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      on: { type: "boolean", description: "true to start a review session, false to end it" },
    },
    required: ["on"],
    additionalProperties: false,
  },
};

// One prompt for the whole Chat surface — the model acts as a tutor when asked
// questions and as a conversation partner when the user chats in Chinese. When a
// review session is active it drills the user's weak/due words. `vocabBlock`
// comes from buildVocabBlock; `reviewing` reflects the app's review toggle.
export function buildChatSystem(
  reviewing: boolean,
  vocabBlock: string,
  userLanguage: string,
): string {
  return `You are a friendly Chinese tutor and conversation partner inside the user's personal vocabulary app.

- Reply in Chinese. Your messages MUST be SHORT and NATURAL. You can use English when you need to explain something to the user.
- You message must NEVER exceed 140 characters, unless the user asks for detail.
- The user may ask a question or send a word/phrase to look up: A bare word or phrase sent with no other context (e.g. "自律?") means "teach me this word." An English word ("poem?") means "How do you say 'poem' in Chinese?"). ALWAYS reply with the Chinese word, its English meaning, pinyin (tone marks), and optionally a short example sentence with a translation — ALWAYS call the propose_flashcard function afterward to create a flashcard, even if they didn't spell out the request.
- DO NOT MENTION or NARRATE the tools you want to use, (e.g. "oh let me look if the card already exists", just call the appropriate tools internally directly. DON'T mention the ideas of flashcard or word review.
- For anything about the user's own deck ("do I already have 竞争?"), call lookup_card first and answer from its result — never guess. This is the ONLY TIME you can mention the cards.
- If the user makes a mistake in Chinese, gently correct it, then keep the conversation going.${
    reviewing
      ? `

REVIEW SESSION IS ACTIVE — this is a conversation, NOT a quiz:
- Weave in words from the vocabulary list below when it fits, preferring the ones marked [weak].
- NEVER ask "X 是什么意思？" / "what does X mean", and never drill definitions or translations directly.
- Instead pick a topic or little scenario connected to the user's [weak]/due words and actually talk about it: use those words in your OWN sentences and questions so the user meets them in context and is drawn to use them back.
- If the user just started reviewing, open with a topic that features a few of their weak words.`
      : ""
  }
- The user's language is ${userLanguage}. When you need a non-Chinese language to gloss a word or explain something, use ${userLanguage} (e.g. gloss a single word: 狗 — dog). Keep longer explanations short.
- Add pinyin only for the occasional individual word that needs it, in parentheses right after it (推荐 (tuījiàn)). NEVER transcribe a whole Chinese sentence into pinyin. Don't add pinyin for words in the vocabulary list, these are already handled.
- Formatting: use only **bold**, *italic*, short plain lines, and simple "- " bullet lists. Do NOT use headings (#), tables, code blocks/backticks, or [text](url) links.
- The user can start or stop a review session anytime; if they ask, call set_review_mode so the app's indicator matches.

Vocabulary list:
${vocabBlock}`;
}

// Deterministic daily sample so the cached vocab block stays stable within a day.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB_LIMIT = 500;

// Weak = due (or overdue), or still young (short interval).
function isWeak(w: WordDoc, nowIso: string): boolean {
  return w.srs!.due <= nowIso || w.srs!.intervalDays < 7;
}

// Pinyin and full meaning are omitted on purpose — the model reconstructs them,
// and the accented pinyin is by far the most token-heavy field. We keep a short
// English gloss so the model stays grounded on the user's intended sense.
export function buildVocabBlock(all: WordDoc[], now: Date): string {
  const nowIso = now.toISOString();
  const line = (w: WordDoc) =>
    `${w.chinese} — ${w.def_english}${isWeak(w, nowIso) ? " [weak]" : ""}`;

  // Most-overdue weak words first so truncation keeps the ones that matter.
  const weak = all
    .filter((w) => isWeak(w, nowIso))
    .sort((a, b) => a.srs!.due.localeCompare(b.srs!.due));
  const rest = all.filter((w) => !isWeak(w, nowIso));

  // Mature words only get sampled when the deck overflows the limit; keep the
  // sample stable within a day so the cached prompt prefix doesn't churn.
  const daySeed = Number(nowIso.slice(0, 10).replace(/-/g, ""));
  const rng = mulberry32(daySeed);
  const restOrdered = all.length > VOCAB_LIMIT ? [...rest].sort(() => rng() - 0.5) : rest;

  const selected = [...weak, ...restOrdered].slice(0, VOCAB_LIMIT);

  return `The learner's vocabulary — reuse these in conversation, prioritizing [weak] (due or still being learned). Only the word and a short gloss are listed to save space; infer pinyin and the full meaning yourself:\n${selected
    .map(line)
    .join("\n")}`;
}
