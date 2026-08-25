// The language the AI falls back to when it explains something outside Chinese.
// Shared because both sides need the same value: the app seeds the setting with
// it, and the server uses it when a client sends no language at all.
export const DEFAULT_USER_LANGUAGE = "English";

export type ChatRole = "user" | "computer";

// One stored turn, as GET /api/chat/history returns it
// the front end forgets the tool calls
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// What the AI proposes when it calls propose_flashcard: a WordInput minus
// `learn_writing`. Deliberately its
// own declaration rather than Omit<WordInput, "learn_writing"> — a field added to
// WordInput later would silently claim the model supplies it, when in fact the
// model only ever sends what the tool schema in prompts.ts asks for.
export interface FlashcardProposal {
  chinese: string;
  pinyin: string;
  english: string;
  comments: string;
}

//  ::::::::  :::    :::     ::: :::::::::::
// :+:    :+: :+:    :+:   :+: :+:   :+:
// +:+        +:+    +:+  +:+   +:+  +:+
// +#+        +#++:++#++ +#++:++#++: +#+
// +#+        +#+    +#+ +#+     +#+ +#+
// #+#    #+# #+#    #+# #+#     #+# #+#
//  ########  ###    ### ###     ### ###

// ChatRequest is the question (from the user), singular, sent up front.
// ChatEvent is the answer (from the model), arriving in pieces.

// Body of POST /api/chat
// one ChatRequest per turn, the reply comes back as many ChatEvents.
// Every field is optional because this lands as untrusted JSON off the wire;
export interface ChatRequest {
  message?: string;
  // The review toggle's current state, so the server can drill due words.
  reviewing?: boolean;
  // "Start review" tapped with no message — the server greets the user without
  // storing a user turn. Implies reviewing.
  kickoff?: boolean;
  // Explanation-fallback language from Settings; the server substitutes
  // DEFAULT_USER_LANGUAGE when it's missing or blank.
  userLanguage?: string;
}

// Events streamed over SSE (server sent events) from POST /api/chat
//
// Server Sent Events, it's an HTTP message with Content-Type: text/event-stream
//
// It writes messages in a simple line format, each terminated by a blank line:
// data: {"type":"delta","text":"你"}
// data: {"type":"flashcard","card":{...}}
// data: {"type":"done"}
//
// the LLM generates tokens incrementally, so instead of waiting for the whole reply and sending one JSON blob, the server emits delta events as text arrives (that's the typing effect), plus structured side-events (flashcard, credits, review_mode) interleaved in the same stream, ending with done or error.

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "flashcard"; card: FlashcardProposal }
  | { type: "credits"; chinese: string[] }
  | { type: "review_mode"; on: boolean } // AI started/stopped a review session
  | { type: "done" }
  | { type: "error"; message: string };
