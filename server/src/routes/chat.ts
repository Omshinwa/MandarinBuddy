// DeepSeek exposes an OpenAI-compatible API — same code would work for any
// OpenAI-compatible provider by changing the base URL, key and model.
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const MAX_HISTORY_TURNS = 30; // we dont give more than that many msg to the ai

// The tool result for a card that made it onto the user's screen.
const CARD_SHOWN_RESULT = "card shown to the user with a one-tap Add button";

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import {
  applyGrade,
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  DEFAULT_USER_LANGUAGE,
  type FlashcardProposal,
} from "../../../shared/src";
import { type ChatDoc, chats, words } from "../db";
import { chatTools, buildChatSystem, buildVocabBlock } from "../prompts";

export const chatRoute = new Hono();

// GET /api/chat/history
// Oldest first, and the flashcards are stripped. The ChatMessage return
// annotation is what holds the endpoint to the shared shape — without it this
// literal could drift from the type the app fetches and nothing would complain.
chatRoute.get("/history", async (c) => {
  const docs: ChatDoc[] = await chats.find({}).sort({ createdAt: 1 }).toArray();
  return c.json(docs.map((d): ChatMessage => ({ role: d.role, content: d.content })));
});

// DELETE /api/chat/history
chatRoute.delete("/history", async (c) => {
  await chats.deleteMany({});
  return c.json({ ok: true });
});

// Credit dictionary words the user produced (once per word per day).
async function creditUsedWords(message: string, now: Date): Promise<string[]> {
  const today = now.toISOString().slice(0, 10);
  const all = await words.find({}).toArray();
  const credited: string[] = [];
  for (const w of all) {
    if (!w.chinese) continue;
    if (!message.includes(w.chinese)) continue;
    if (w.convCreditDate === today) continue;
    await words.updateOne(
      { _id: w._id },
      {
        $set: {
          // Typing the word yourself shows you know its meaning and can produce
          // it, so meaning and (once started) writing get the nudge. It says
          // nothing about tones, so reading gets none.
          "facets.meaning": applyGrade(w.facets.meaning, "conversation_used", now),
          ...(w.facets.writing.lastReviewed && {
            "facets.writing": applyGrade(w.facets.writing, "conversation_used", now),
          }),
          convCreditDate: today,
          updatedAt: now,
        },
      },
    );
    credited.push(w.chinese);
  }
  return credited;
}

// Escape user input before dropping it into a MongoDB $regex.
// Add backslashes before special chars
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Backs the lookup_card tool: search the user's real cards (Chinese, pinyin, or
// English) and return matches so the model can answer from the deck, not a guess.
async function runLookupCard(rawArgs: string): Promise<string> {
  let query = "";
  try {
    const parsed = JSON.parse(rawArgs) as Record<string, unknown>;
    if (typeof parsed.query === "string") query = parsed.query.trim();
  } catch {
    // fall through to the empty-query response
  }
  if (!query) return JSON.stringify({ matches: [] });
  const rx = { $regex: escapeRegex(query), $options: "i" };
  const found = await words
    .find({ $or: [{ chinese: rx }, { pinyin: rx }, { english: rx }] })
    .limit(10)
    .toArray();
  return JSON.stringify({
    query,
    matches: found.map((w) => ({
      chinese: w.chinese,
      pinyin: w.pinyin,
      english: w.english,
    })),
  });
}

// We store the AI's turn as role "computer"; the API calls it "assistant". This
// is the only place the two vocabularies meet — everything below builds API
// requests, so "assistant" past this point always means the wire protocol.
function toApiRole(role: ChatDoc["role"]): "user" | "assistant" {
  return role === "computer" ? "assistant" : "user";
}

// stored ChatDoc message -> OpenAI message(s) sent back to the model.

// If it's a simple plain turn (user turn, or a computer turn with no cards) → 1 message:
// { role: "user",  content: "太 means what?" }        // ChatDoc{role:"user"}
// { role: "assistant", content: "It means too..." }  // ChatDoc{role:"computer"}

// If it's a computer turn that proposed N flashcards → N + 1 messages:
// { role: "assistant", content: "...", tool_calls: [call_0, call_1] }
// { role: "tool", tool_call_id: "h<docid>_0", content: CARD_SHOWN_RESULT } // call_0
// { role: "tool", tool_call_id: "h<docid>_1", content: CARD_SHOWN_RESULT } // call_1

// the id in the tool_calls has to match the tool messages id.
// for a chat doc whose _id is ObjectId("68a72f1b9c4e2a0011ab3c7d") holding two cards:
// "tool_calls": [
//   { "id": "h68a72f1b9c4e2a0011ab3c7d_0", "type": "function",
//     "function": { "name": "propose_flashcard", "arguments": "{\"hanzi\":\"太\",...}" } },
//   { "id": "h68a72f1b9c4e2a0011ab3c7d_1", "type": "function",
//     "function": { "name": "propose_flashcard", "arguments": "{\"hanzi\":\"就\",...}" } }
// ]

// terminology
// Each { role: ... } object is a message.
// The array you hand to chat.completions.create({ messages }) is the conversation.
// In the SDK types that's ChatCompletionMessageParam, which is a union of the five message variants:
// system, user, assistant, tool, developer.

function replayHistoryDoc(d: ChatDoc): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (d.role !== "computer" || !d.cards?.length) {
    // user message, or theres no flashcard proposal
    return [{ role: toApiRole(d.role), content: d.content }];
  }
  // else, more complex
  const calls = d.cards.map(
    (card, i): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => ({
      id: `h${d._id.toHexString()}_${i}`,
      type: "function",
      function: { name: "propose_flashcard", arguments: JSON.stringify(card) },
    }),
  );

  return [
    { role: "assistant", content: d.content || null, tool_calls: calls },
    ...calls.map(
      (c): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: "tool",
        tool_call_id: c.id,
        content: CARD_SHOWN_RESULT,
      }),
    ),
  ];
}

// A tool call as it arrives off the wire: name and arguments both stream in
// fragments, so they're plain strings until we parse them.
type PendingToolCall = { id: string; name: string; args: string };

type Send = (ev: ChatEvent) => Promise<void>;

// forward (send(...)) text deltas to the app as they arrive
// return the accumulate text and tool-call
async function streamTurn(
  deepseek: OpenAI,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  send: Send,
  reviewing: boolean,
): Promise<{ text: string; toolCalls: PendingToolCall[]; finishReason: string | null }> {
  const stream = await deepseek.chat.completions.create({
    model: MODEL,
    messages, // whole chat context
    tools: chatTools(reviewing),
    stream: true,
    max_tokens: 4096,
    // variance for the model prediction
    temperature: 1.0,
  });

  let text = "";
  // Tool-call arguments stream in fragments — accumulate them per index.
  const toolCalls: PendingToolCall[] = [];
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    if (choice.delta?.content) {
      text += choice.delta.content;
      await send({ type: "delta", text: choice.delta.content }); // sent to front
    }
    for (const tc of choice.delta?.tool_calls ?? []) {
      // slot is a reference into toolCalls
      // ??= operator, assign the right side only if the left side is null/undefined.
      const slot = (toolCalls[tc.index] ??= { id: "", name: "", args: "" });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
    }
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return { text, toolCalls, finishReason };
}

// Run one tool call. `result` is the string the model reads on the next
// iteration; `card` is set only when a proposal actually reached the screen,
// and the caller is the one that records it.
async function runToolCall(
  tc: PendingToolCall,
  send: Send,
): Promise<{ result: string; card?: FlashcardProposal }> {
  if (tc.name === "lookup_card") {
    return { result: await runLookupCard(tc.args) };
  }

  // One-way on purpose: only the user starts a review (see chatTools).
  if (tc.name === "end_review_mode") {
    await send({ type: "review_mode", on: false });
    return { result: "review session ended" };
  }

  if (tc.name === "propose_flashcard") {
    const card = parseFlashcard(tc.args);
    if (!card) return { result: "invalid arguments; card not shown" };
    // Never propose a word that's already a card — check the deck first.
    const existing = await words.findOne({ chinese: card.chinese });
    if (existing) {
      return {
        result: `"${existing.chinese}" (${existing.english}) is already in the user's deck — tell them it's already saved; do not propose it again`,
      };
    }
    await send({ type: "flashcard", card });
    return { result: CARD_SHOWN_RESULT, card };
  }

  return { result: "ok" };
}

// DeepSeek has no strict schema mode — validate the tool arguments before trusting them.
function parseFlashcard(raw: string): FlashcardProposal | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.chinese !== "string" || !parsed.chinese.trim()) return null;
    if (typeof parsed.pinyin !== "string" || !parsed.pinyin.trim()) return null;
    if (typeof parsed.english !== "string" || !parsed.english.trim()) return null;
    return {
      chinese: parsed.chinese.trim(),
      pinyin: parsed.pinyin.trim(),
      english: parsed.english.trim(),
      // The only optional field: the model can omit it, or send a non-string.
      comments: typeof parsed.comments === "string" ? parsed.comments : "",
    };
  } catch {
    return null;
  }
}

// kickoff = the user tapped "start review" with no message; we greet them without
// storing a user turn.

// POST /api/chat -
// user sends a question as ChatRequest (in the body);
// they will receive a SSE of ChatEvents as response
chatRoute.post("/", async (c) => {
  const body = (await c.req.json()) as ChatRequest;

  // `as ChatRequest` is a cast for compile time,
  // But on runtime, we gotta check what we received:
  // #region: check correct shape
  const message = body.message?.trim();
  const kickoff = body.kickoff === true;
  const reviewing = body.reviewing === true || kickoff; // starting a review implies review mode
  const userLanguage =
    typeof body.userLanguage === "string" && body.userLanguage.trim()
      ? body.userLanguage.trim()
      : DEFAULT_USER_LANGUAGE;

  if (!message && !kickoff) return c.json({ error: "message required" }, 400);

  // #endregion

  if (!process.env.DEEPSEEK_API_KEY) {
    return c.json({ error: "DEEPSEEK_API_KEY is not set in server/.env" }, 500);
  }
  const deepseek = new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  const now = new Date();

  // normal msg
  if (message && !kickoff) {
    // we push it to the DB
    await chats.insertOne({ role: "user", content: message, createdAt: now } as never);
  }

  // System prompt goes in the messages array (OpenAI convention). No cache
  // annotations needed — DeepSeek context caching is automatic.
  const systemText = buildChatSystem(
    reviewing,
    buildVocabBlock(await words.find({}).toArray(), now),
    userLanguage,
  );

  const historyDocs = await chats
    .find({})
    .sort({ createdAt: -1 })
    .limit(MAX_HISTORY_TURNS)
    .toArray();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemText },
    ...historyDocs.reverse().flatMap(replayHistoryDoc),
  ];
  // A tapped "start review" has no user text — give the model a cue to greet.
  if (kickoff) messages.push({ role: "user", content: "（开始复习）" });

  return streamSSE(c, async (sse) => {
    const send = (ev: ChatEvent) => sse.writeSSE({ data: JSON.stringify(ev) });

    try {
      if (message && !kickoff) {
        const credited = await creditUsedWords(message, now);
        if (credited.length > 0) await send({ type: "credits", chinese: credited });
      }

      let replyText = "";
      const proposedCards: FlashcardProposal[] = [];
      // Drops to false if the model ends the review, so it isn't offered
      // end_review_mode again on the next pass of the loop.
      let sessionActive = reviewing;
      // Tool loop: stream → if the model called propose_flashcard, forward it to the
      // app, append a tool result, and continue the same turn.
      for (let iteration = 0; iteration < 4; iteration++) {
        const { text, toolCalls, finishReason } = await streamTurn(
          deepseek,
          messages,
          send,
          sessionActive,
        );
        replyText += text;

        if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        // Run each tool call and feed a real result back so the turn can continue.
        for (const tc of toolCalls) {
          const { result, card } = await runToolCall(tc, send);
          if (card) proposedCards.push(card);
          if (tc.name === "end_review_mode") sessionActive = false;
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
      }

      if (replyText.trim() || proposedCards.length > 0) {
        await chats.insertOne({
          role: "computer",
          content: replyText,
          ...(proposedCards.length > 0 && { cards: proposedCards }),
          createdAt: new Date(),
        } as never);
      }
      await send({ type: "done" });
    } catch (err) {
      await send({ type: "error", message: err instanceof Error ? err.message : "unknown error" });
    }
  });
});
