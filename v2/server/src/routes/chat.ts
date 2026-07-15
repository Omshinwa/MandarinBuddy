import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import OpenAI from "openai";
import { applyGrade } from "../../../shared/src/srs";
import type { ChatEvent, ChatMode, FlashcardProposal } from "../../../shared/src/types";
import { chats, words } from "../db";
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

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: PROPOSE_FLASHCARD_TOOL.name,
      description: PROPOSE_FLASHCARD_TOOL.description,
      parameters: PROPOSE_FLASHCARD_TOOL.input_schema,
    },
  },
  {
    type: "function",
    function: {
      name: LOOKUP_CARD_TOOL.name,
      description: LOOKUP_CARD_TOOL.description,
      parameters: LOOKUP_CARD_TOOL.input_schema,
    },
  },
  {
    type: "function",
    function: {
      name: SET_REVIEW_MODE_TOOL.name,
      description: SET_REVIEW_MODE_TOOL.description,
      parameters: SET_REVIEW_MODE_TOOL.input_schema,
    },
  },
];

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
    if (!w.chinese || w.chinese.length === 0) continue;
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

// POST /api/chat  — body {mode, message?, reviewing?, kickoff?}; SSE stream of ChatEvent.
// kickoff = the user tapped "start review" with no message; we greet them without
// storing a user turn.
chatRoute.post("/", async (c) => {
  const body = (await c.req.json()) as {
    mode?: string;
    message?: string;
    reviewing?: boolean;
    kickoff?: boolean;
    userLanguage?: string;
  };
  const mode = parseMode(body.mode);
  const message = body.message?.trim();
  const kickoff = body.kickoff === true;
  const reviewing = body.reviewing === true || kickoff; // starting a review implies review mode
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
    ...historyDocs
      .reverse()
      .map((d): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
        role: d.role,
        content: d.content,
      })),
  ];
  // A tapped "start review" has no user text — give the model a cue to greet.
  if (kickoff) messages.push({ role: "user", content: "（开始复习）" });

  return streamSSE(c, async (sse) => {
    const send = (ev: ChatEvent) => sse.writeSSE({ data: JSON.stringify(ev) });

    try {
      if (mode === "conversation" && message && !kickoff) {
        const credited = await creditUsedWords(message, now);
        if (credited.length > 0) await send({ type: "credits", chinese: credited });
      }

      let assistantText = "";
      // Tool loop: stream → if the model called propose_flashcard, forward it to the
      // app, append a tool result, and continue the same turn.
      for (let iteration = 0; iteration < 4; iteration++) {
        const stream = await deepseek.chat.completions.create({
          model: MODEL,
          messages,
          tools: TOOLS,
          stream: true,
          max_tokens: 4096,
          temperature: 1.3, // DeepSeek's recommended setting for conversation
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

      if (assistantText.trim()) {
        await chats.insertOne({
          mode,
          role: "assistant",
          content: assistantText,
          createdAt: new Date(),
        } as never);
      }
      await send({ type: "done" });
    } catch (err) {
      await send({ type: "error", message: err instanceof Error ? err.message : "unknown error" });
    }
  });
});
