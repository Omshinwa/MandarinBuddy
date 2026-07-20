import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { newFacets, newSrs } from "../../../shared/src/srs";
import type { WordInput } from "../../../shared/src/types";
import { serializeWord, words } from "../db";

export const wordsRoute = new Hono();

// Strip tone marks / accents so a search for "ai" matches pinyin like "ài".
// NFD splits an accented letter into base + combining marks, then we drop the marks.
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// GET /api/words?search=&due=true
wordsRoute.get("/", async (c) => {
  const search = fold(c.req.query("search")?.trim() ?? "");
  const dueOnly = c.req.query("due") === "true";
  const nowIso = new Date().toISOString();

  const all = await words.find({ srs: { $exists: true } }).sort({ createdAt: -1 }).toArray();
  const filtered = all.filter((w) => {
    if (dueOnly && w.srs!.due > nowIso) return false;
    if (!search) return true;
    return (
      w.chinese.includes(search) ||
      fold(w.pinyin ?? "").includes(search) ||
      fold(w.def_english ?? "").includes(search) ||
      fold(w.comments ?? "").includes(search)
    );
  });
  return c.json(filtered.map(serializeWord));
});

function validateInput(body: Partial<WordInput>): string | null {
  if (!body.chinese?.trim()) return "chinese is required";
  if (!body.pinyin?.trim()) return "pinyin is required";
  if (!body.def_english?.trim()) return "def_english is required";
  return null;
}

// POST /api/words
wordsRoute.post("/", async (c) => {
  const body = (await c.req.json()) as Partial<WordInput>;
  const error = validateInput(body);
  if (error) return c.json({ error }, 400);

  const chinese = body.chinese!.trim();
  const existing = await words.findOne({ chinese });
  if (existing) return c.json({ error: "already exists", word: serializeWord(existing) }, 409);

  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    chinese,
    pinyin: body.pinyin!.trim(),
    def_english: body.def_english!.trim(),
    comments: body.comments?.trim() ?? "",
    learn_writing: body.learn_writing ?? false,
    srs: newSrs(now),
    facets: newFacets(),
    createdAt: now,
    updatedAt: now,
  };
  await words.insertOne(doc);
  return c.json(serializeWord(doc), 201);
});

// PUT /api/words/:id  — body: partial fields + optional resetProgress: true
wordsRoute.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ObjectId.isValid(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json()) as Partial<WordInput> & {
    resetProgress?: boolean;
    unsuspend?: boolean;
  };

  const $set: Record<string, unknown> = { updatedAt: new Date() };
  for (const field of ["chinese", "pinyin", "def_english", "comments"] as const) {
    if (typeof body[field] === "string") $set[field] = body[field]!.trim();
  }
  if (typeof body.learn_writing === "boolean") $set.learn_writing = body.learn_writing;
  if (body.resetProgress) {
    const now = new Date();
    $set.srs = newSrs(now);
    $set.facets = newFacets();
  } else if (body.unsuspend) {
    // Reactivate a leech: clear the suspend flag. The card's lapse reset it to
    // due-now, so it returns to the queue immediately.
    $set["srs.suspended"] = false;
  }

  const result = await words.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set },
    { returnDocument: "after" },
  );
  if (!result) return c.json({ error: "not found" }, 404);
  return c.json(serializeWord(result));
});

// DELETE /api/words/:id
wordsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!ObjectId.isValid(id)) return c.json({ error: "bad id" }, 400);
  const result = await words.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
