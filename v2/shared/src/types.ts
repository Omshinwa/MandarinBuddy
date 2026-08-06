export type Direction = "meaning" | "reading" | "writing";
export const DIRECTIONS: Direction[] = ["meaning", "reading", "writing"];

export type Grade =
  | "reviewed_remembered" // "Okay"
  | "reviewed_forgot"
  | "reviewed_hard"
  | "reviewed_easy"
  | "conversation_used"
  | "conversation_missed";

export interface Srs {
  due: string; // ISO timestamp — when this direction is next reviewed
  intervalDays: number; // current gap between reviews
  ease: number; // per-direction growth multiplier
  lapses: number; // times forgotten after being learned
  suspended?: boolean; // Anki "leech": too many lapses → pulled from reviews until reactivated
}

// Per-facet mastery, used only to choose which question type to ask (not a
// schedule). `strength` rises with correct answers; `asked` is a rotation
// counter so the picker revisits stronger facets instead of drilling one forever.
export interface Facet {
  strength: number;
  asked: number;
}

export interface Word {
  _id: string;
  chinese: string;
  pinyin: string;
  def_english: string;
  comments: string;
  learn_writing: boolean;
  srs: Srs; // one schedule per card (the question type rotates via `facets`)
  facets: Record<Direction, Facet>;
  convCreditDate?: string; // yyyy-mm-dd of last conversation_used credit
  createdAt?: string;
}

export interface WordInput {
  chinese: string;
  pinyin: string;
  def_english: string;
  comments: string;
  learn_writing: boolean;
}

export interface ReviewItem {
  word: Word;
  direction: Direction;
}

export type ChatMode = "assistant" | "conversation";

// A chat turn the user opened by tapping a banner rather than typing: "review"
// starts a review session, "translate" asks the AI for one English sentence to
// translate into Chinese. Neither stores a user message.
export type Kickoff = "review" | "translate";

export interface ChatMessage {
  _id?: string;
  mode: ChatMode;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface FlashcardProposal {
  chinese: string;
  pinyin: string;
  english: string;
  example: string;
}

// Events streamed over SSE from POST /api/chat
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "flashcard"; card: FlashcardProposal }
  | { type: "credits"; chinese: string[] }
  | { type: "review_mode"; on: boolean } // AI started/stopped a review session
  | { type: "done" }
  | { type: "error"; message: string };
