import type OpenAI from "openai";
import { stripEmphasis } from "../../shared/src";
import type { WordDoc } from "./db";

// The tools handed to the model on every chat turn (see chatTools for the ones
// that come and go with the review session). DeepSeek has no strict
// schema mode, so no `strict` flag is set here — arguments are validated by
// hand on arrival (see parseFlashcard in routes/chat.ts).
export const CHAT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "propose_flashcard",
      description:
        "Propose a flashcard for a Chinese word/phrase the user is learning. Call it whenever a specific word comes up — including when the user just sends a bare word to learn — so they can save it with one tap. If the word is already in their deck, the app reports that back instead of showing a duplicate, so you can call it freely.",
      parameters: {
        type: "object",
        properties: {
          chinese: { type: "string" },
          pinyin: { type: "string", description: "with tone marks" },
          english: { type: "string" },
          comments: {
            type: "string",
            description: "short example sentence with translation",
          },
        },
        required: ["chinese", "pinyin", "english", "comments"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_card",
      description:
        "Search the user's saved flashcard deck to check whether a word/phrase is already a card. Call this before telling the user whether they've already saved something, or when they ask what is in their deck. Never guess — always look it up.",
      parameters: {
        type: "object",
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
    },
  },
];

// Only offered while a session is running: the model can close a review, never
// open one. Starting is the user's call — they tap the banner in the app.
const END_REVIEW_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "end_review_mode",
    description:
      "End the user's review session, so the app's review indicator matches what you are doing. Call it when the user asks to stop reviewing, or when the session has run its course and the conversation has moved on to something else.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

// The tool list for one turn. `end_review_mode` only exists while a session is
// active — with no session there is nothing to end.
export function chatTools(reviewing: boolean): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return reviewing ? [...CHAT_TOOLS, END_REVIEW_TOOL] : CHAT_TOOLS;
}

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

- Reply in Chinese. Your messages MUST be SHORT and NATURAL. You can use ${userLanguage} when you need to explain something or if the user asks a question in ${userLanguage}.
- Your message must not exceed 4 sentences.
- The user may send a Chinese word/phrase with no other context (e.g. "自律?"). This means "teach me this word." An English word ("poem?") means "How do you say 'poem' in Chinese?"). ALWAYS call the propose_flashcard function afterward to create a flashcard, even if they didn't spell out the request.
- For anything about the user's own deck ("do I already have 竞争?"), call lookup_card first and answer from its result.
- DO NOT MENTION or NARRATE the tools you want to use, e.g. "oh let me look if the card already exists", just call the appropriate tools internally directly. DON'T mention the ideas of flashcard or word review (except when using the tool lookup_card).
- If the user makes a mistake in Chinese, gently correct it.
- Whatever language you write in, write it correctly: real words, correct spelling and grammar, no invented or half-formed words.
- Add pinyin only for the occasional individual word that needs it, in parentheses right after it (推荐 (tuījiàn)). NEVER transcribe a whole Chinese sentence into pinyin. 
- Don't add pinyin or English translation for words in the vocabulary list, these are already handled.
- A review session is the user's to start — they tap a button in the app for it. NEVER claim to have started one, and never offer to.
${
  reviewing
    ? `
REVIEW SESSION IS ACTIVE — this is a conversation, NOT a quiz:
- Weave in words from the vocabulary list below when it fits, preferring the ones marked [weak].
- NEVER ask "X 是什么意思？" / "what does X mean". Instead pick a topic or little scenario connected to the user's [weak]/due words.
- If the user just started reviewing, open with a topic that features a few of their weak words.
- Call end_review_mode when the user asks to stop, or once the session has run its course and the conversation has clearly moved on — the app's indicator has to match.
`
    : ""
}
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
  return w.srs.due <= nowIso || w.srs.intervalDays < 7;
}

// Pinyin and full meaning are omitted on purpose — the model reconstructs them,
// and the accented pinyin is by far the most token-heavy field. We keep a short
// English gloss so the model stays grounded on the user's intended sense.
export function buildVocabBlock(all: WordDoc[], now: Date): string {
  const nowIso = now.toISOString();
  // Emphasis markers are an authoring note on the card, not part of the word —
  // send the plain form so the model never echoes 话<题> back into the chat.
  const line = (w: WordDoc) =>
    `${stripEmphasis(w.chinese)} — ${stripEmphasis(w.english)}${
      isWeak(w, nowIso) ? " [weak]" : ""
    }`;

  // Most-overdue weak words first so truncation keeps the ones that matter.
  const weak = all
    .filter((w) => isWeak(w, nowIso))
    .sort((a, b) => a.srs.due.localeCompare(b.srs.due));
  const rest = all.filter((w) => !isWeak(w, nowIso));

  // Mature words only get sampled when the deck overflows the limit; keep the
  // sample stable within a day so the cached prompt prefix doesn't churn.
  const daySeed = Number(nowIso.slice(0, 10).replace(/-/g, ""));
  const rng = mulberry32(daySeed);
  const restOrdered = all.length > VOCAB_LIMIT ? [...rest].sort(() => rng() - 0.5) : rest;

  const selected = [...weak, ...restOrdered].slice(0, VOCAB_LIMIT);

  return `The learner's vocabulary — reuse these in conversation, prioritizing [weak] (due or still being learned):\n${selected
    .map(line)
    .join("\n")}`;
}
