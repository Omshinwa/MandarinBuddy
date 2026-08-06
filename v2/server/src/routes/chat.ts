// check le prompt (how language is integrated, because rn it's really bad at following instructions)


import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import { applyGrade } from "../../../shared/src/srs";
import type { ChatEvent, ChatMode, FlashcardProposal, Kickoff } from "../../../shared/src/types";
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

function parseMode(value: string | undefined): ChatMode | null {
  return value === "assistant" || value === "conversation" ? value : null;
}

// GET /api/chat/history?mode=
chatRoute.get("/history", async (c) => {
  const mode = parseMode(c.req.query("mode"));
  if (!mode) return c.json({ error: "bad mode" }, 400);
  const docs = await chats.find({ mode }).sort({ createdAt: 1 }).toArray();
  return c.json(
    docs.map((d) => ({
      _id: d._id.toHexString(),
      mode: d.mode,
      role: d.role,
      content: d.content,
      createdAt: d.createdAt.toISOString(),
    })),
  );
});

// DELETE /api/chat/history?mode=
chatRoute.delete("/history", async (c) => {
  const mode = parseMode(c.req.query("mode"));
  if (!mode) return c.json({ error: "bad mode" }, 400);
  await chats.deleteMany({ mode });
  return c.json({ ok: true });
});

// In conversation mode, credit dictionary words the user produced (once per word per day).
async function creditUsedWords(message: string, now: Date): Promise<string[]> {
  const today = now.toISOString().slice(0, 10);
  const all = await words.find({ srs: { $exists: true } }).toArray();
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
          srs: applyGrade(w.srs!, "conversation_used", now),
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
    .find({
      srs: { $exists: true },
      $or: [{ chinese: rx }, { pinyin: rx }, { def_english: rx }],
    })
    .limit(10)
    .toArray();
  return JSON.stringify({
    query,
    matches: found.map((w) => ({
      chinese: w.chinese,
      pinyin: w.pinyin ?? "",
      english: w.def_english ?? "",
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
      example: typeof parsed.example === "string" ? parsed.example : "",
    };
  } catch {
    return null;
  }
}

// Rebuild a stored chat turn into the OpenAI message(s) sent back to the model.
// A plain turn is one message; an assistant turn that proposed flashcards is
// expanded into the assistant tool_calls message plus a matching tool result for
// each card, so the replayed history shows the model actually calling the tool
// (not just narrating a word). tool_call_id must be unique and paired — we derive
// it from the doc id so the assistant/tool messages line up.
function replayHistoryDoc(d: ChatDoc): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (d.role !== "assistant" || !d.cards?.length) {
    return [{ role: d.role, content: d.content }];
  }
  const calls = d.cards.map((card, i) => ({
    id: `h${d._id.toHexString()}_${i}`,
    type: "function" as const,
    function: { name: "propose_flashcard", arguments: JSON.stringify(card) },
  }));
  return [
    { role: "assistant", content: d.content || null, tool_calls: calls },
    ...calls.map((c): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
      role: "tool",
      tool_call_id: c.id,
      content: "card shown to the user with a one-tap Add button",
    })),
  ];
}

// The cue pushed in place of the missing user turn, per kickoff kind.
const KICKOFF_CUE: Record<Kickoff, string> = {
  review: "（开始复习）",
  translate: "（翻译练习）",
};

function parseKickoff(value: unknown): Kickoff | null {
  return value === "review" || value === "translate" ? value : null;
}

// POST /api/chat  — body {mode, message?, reviewing?, kickoff?}; SSE stream of ChatEvent.
chatRoute.post("/", async (c) => {
  const body = (await c.req.json()) as {
    mode?: string;
    message?: string;
    reviewing?: boolean;
    kickoff?: string;
    userLanguage?: string;
  };
  const mode = parseMode(body.mode);
  const message = body.message?.trim();
  const kickoff = parseKickoff(body.kickoff);
  // Starting a review implies review mode; a translation challenge doesn't — it
  // works either way, and only leans on the vocabulary list when a review is on.
  const reviewing = body.reviewing === true || kickoff === "review";
  // The user's explanation-fallback language (from Settings); default keeps the
  // prior bilingual behaviour if the client sends nothing.
  const userLanguage =
    typeof body.userLanguage === "string" && body.userLanguage.trim()
      ? body.userLanguage.trim()
      : "English & French";
  if (!mode || (!message && !kickoff)) return c.json({ error: "mode and message required" }, 400);

  if (!process.env.DEEPSEEK_API_KEY) {
    return c.json({ error: "DEEPSEEK_API_KEY is not set in server/.env" }, 500);
  }
  const deepseek = new OpenAI({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
  const now = new Date();

  if (message && !kickoff) {
    await chats.insertOne({ mode, role: "user", content: message, createdAt: now } as never);
  }

  // System prompt goes in the messages array (OpenAI convention). No cache
  // annotations needed — DeepSeek context caching is automatic.
  const systemText = buildChatSystem(
    reviewing,
    buildVocabBlock(await words.find({ srs: { $exists: true } }).toArray(), now),
    userLanguage,
  );

  const historyDocs = await chats
    .find({ mode })
    .sort({ createdAt: -1 })
    .limit(HISTORY_TURNS)
    .toArray();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemText },
    ...historyDocs.reverse().flatMap(replayHistoryDoc),
  ];
  // A tapped banner has no user text — give the model a cue to act on instead.
  if (kickoff) messages.push({ role: "user", content: KICKOFF_CUE[kickoff] });

  return streamSSE(c, async (sse) => {
    const send = (ev: ChatEvent) => sse.writeSSE({ data: JSON.stringify(ev) });

    try {
      if (mode === "conversation" && message && !kickoff) {
        const credited = await creditUsedWords(message, now);
        if (credited.length > 0) await send({ type: "credits", chinese: credited });
      }

      let assistantText = "";
      // Cards actually shown this turn — persisted with the assistant doc so the
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
            assistantText += choice.delta.content;
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
              const existing = await words.findOne({
                chinese: card.chinese,
                srs: { $exists: true },
              });
              if (existing) {
                result = `"${existing.chinese}" (${existing.def_english}) is already in the user's deck — tell them it's already saved; do not propose it again`;
              } else {
                await send({ type: "flashcard", card });
                proposedCards.push(card);
                result = "card shown to the user with a one-tap Add button";
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

      if (assistantText.trim() || proposedCards.length > 0) {
        await chats.insertOne({
          mode,
          role: "assistant",
          content: assistantText,
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
