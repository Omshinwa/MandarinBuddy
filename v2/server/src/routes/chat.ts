import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import {
  applyGrade,
  type ChatEvent,
  DEFAULT_USER_LANGUAGE,
  type FlashcardProposal,
} from "../../../shared/src";
import { type ChatDoc, chats, words } from "../db";
import {
  LOOKUP_CARD_TOOL,
  PROPOSE_FLASHCARD_TOOL,
  SET_REVIEW_MODE_TOOL,
  buildChatSystem,
  buildVocabBlock,
} from "../prompts";

// DeepSeek exposes an OpenAI-compatible API — same code would work for any
// OpenAI-compatible provider by changing the base URL, key and model.
// The previous Claude implementation is preserved in chat_claude.old.
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const HISTORY_TURNS = 30;

export const chatRoute = new Hono();

// Wrap each tool def (from prompts.ts) in OpenAI's function-tool shape. The
// `strict` flag they carry is intentionally not forwarded — DeepSeek has no
// strict schema mode, so arguments are validated by hand (see parseFlashcard).
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  PROPOSE_FLASHCARD_TOOL,
  LOOKUP_CARD_TOOL,
  SET_REVIEW_MODE_TOOL,
].map((tool) => ({
  type: "function",
  function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
}));

// The tool result for a card that made it onto the user's screen. Sent live when
// the card is proposed, and replayed with the stored turn (see replayHistoryDoc),
// so both paths have to say the same thing.
const CARD_SHOWN_RESULT = "card shown to the user with a one-tap Add button";

// GET /api/chat/history
chatRoute.get("/history", async (c) => {
  const docs = await chats.find({}).sort({ createdAt: 1 }).toArray();
  return c.json(
    docs.map((d) => ({
      _id: d._id.toHexString(),
      role: d.role,
      content: d.content,
      createdAt: d.createdAt.toISOString(),
    })),
  );
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
          // Nudges the card's schedule only — facets are untouched, since using a
          // word in conversation isn't an answer to any specific question type.
          srs: applyGrade(w.srs, "conversation_used", now),
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

// Reads the `on` boolean from a set_review_mode tool call.
function parseReviewMode(rawArgs: string): boolean {
  try {
    return (JSON.parse(rawArgs) as Record<string, unknown>).on === true;
  } catch {
    return false;
  }
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
      // `example` on the wire, `comments` everywhere else — see FlashcardProposal.
      comments: typeof parsed.example === "string" ? parsed.example : "",
    };
  } catch {
    return null;
  }
}

// The inverse of parseFlashcard's field mapping, for replaying a stored proposal
// back to the model. Without it the replayed tool call would use our field name
// and quietly teach the model to answer with `comments` instead of `example`.
function toWireCard(card: FlashcardProposal): Record<string, string> {
  return {
    chinese: card.chinese,
    pinyin: card.pinyin,
    english: card.english,
    example: card.comments,
  };
}

// We store the AI's turn as role "computer"; the API calls it "assistant". This
// is the only place the two vocabularies meet — everything below builds API
// requests, so "assistant" past this point always means the wire protocol.
function toApiRole(role: ChatDoc["role"]): "user" | "assistant" {
  return role === "computer" ? "assistant" : "user";
}

// Rebuild a stored chat turn into the OpenAI message(s) sent back to the model.
// A plain turn is one message; a computer turn that proposed flashcards is
// expanded into the assistant tool_calls message plus a matching tool result for
// each card, so the replayed history shows the model actually calling the tool
// (not just narrating a word). tool_call_id must be unique and paired — we derive
// it from the doc id so the assistant/tool messages line up.
function replayHistoryDoc(d: ChatDoc): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (d.role !== "computer" || !d.cards?.length) {
    return [{ role: toApiRole(d.role), content: d.content }];
  }
  const calls = d.cards.map((card, i) => ({
    id: `h${d._id.toHexString()}_${i}`,
    type: "function" as const,
    function: { name: "propose_flashcard", arguments: JSON.stringify(toWireCard(card)) },
  }));
  return [
    { role: "assistant", content: d.content || null, tool_calls: calls },
    ...calls.map((c): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
      role: "tool",
      tool_call_id: c.id,
      content: CARD_SHOWN_RESULT,
    })),
  ];
}

// POST /api/chat  — body {message?, reviewing?, kickoff?}; SSE stream of ChatEvent.
// kickoff = the user tapped "start review" with no message; we greet them without
// storing a user turn.
chatRoute.post("/", async (c) => {
  const body = (await c.req.json()) as {
    message?: string;
    reviewing?: boolean;
    kickoff?: boolean;
    userLanguage?: string;
  };
  const message = body.message?.trim();
  const kickoff = body.kickoff === true;
  const reviewing = body.reviewing === true || kickoff; // starting a review implies review mode
  // The user's explanation-fallback language (from Settings); the shared default
  // covers a client that sends nothing.
  const userLanguage =
    typeof body.userLanguage === "string" && body.userLanguage.trim()
      ? body.userLanguage.trim()
      : DEFAULT_USER_LANGUAGE;
  if (!message && !kickoff) return c.json({ error: "message required" }, 400);

  if (!process.env.DEEPSEEK_API_KEY) {
    return c.json({ error: "DEEPSEEK_API_KEY is not set in server/.env" }, 500);
  }
  const deepseek = new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  const now = new Date();

  if (message && !kickoff) {
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
    .limit(HISTORY_TURNS)
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
      // Cards actually shown this turn — persisted with the computer doc so the
      // tool call survives into replayed history (see replayHistoryDoc).
      const proposedCards: FlashcardProposal[] = [];
      // Tool loop: stream → if the model called propose_flashcard, forward it to the
      // app, append a tool result, and continue the same turn.
      for (let iteration = 0; iteration < 4; iteration++) {
        const stream = await deepseek.chat.completions.create({
          model: MODEL,
          messages,
          tools: TOOLS,
          stream: true,
          max_tokens: 4096,
          // DeepSeek's recommended setting for conversation. Note it also makes
          // longer non-Chinese passages wobble — French especially, where the
          // model is weak enough to sample non-words. Lower it if that shows up.
          temperature: 1.3,
        });

        let iterationText = "";
        // Tool-call arguments stream in fragments — accumulate them per index.
        const toolCalls: { id: string; name: string; args: string }[] = [];
        let finishReason: string | null = null;

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.delta?.content) {
            iterationText += choice.delta.content;
            replyText += choice.delta.content;
            await send({ type: "delta", text: choice.delta.content });
          }
          for (const tc of choice.delta?.tool_calls ?? []) {
            const slot = (toolCalls[tc.index] ??= { id: "", name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

        messages.push({
          role: "assistant",
          content: iterationText || null,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.args },
          })),
        });

        // Run each tool call and feed a real result back so the turn can continue.
        for (const tc of toolCalls) {
          let result = "ok";
          if (tc.name === "propose_flashcard") {
            const card = parseFlashcard(tc.args);
            if (!card) {
              result = "invalid arguments; card not shown";
            } else {
              // Never propose a word that's already a card — check the deck first.
              const existing = await words.findOne({ chinese: card.chinese });
              if (existing) {
                result = `"${existing.chinese}" (${existing.english}) is already in the user's deck — tell them it's already saved; do not propose it again`;
              } else {
                await send({ type: "flashcard", card });
                proposedCards.push(card);
                result = CARD_SHOWN_RESULT;
              }
            }
          } else if (tc.name === "lookup_card") {
            result = await runLookupCard(tc.args);
          } else if (tc.name === "set_review_mode") {
            const on = parseReviewMode(tc.args);
            await send({ type: "review_mode", on });
            result = on ? "review session started" : "review session ended";
          }
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
