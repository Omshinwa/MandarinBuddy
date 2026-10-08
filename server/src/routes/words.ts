import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { type Facet, FACETS, newSrs, type Srs, type WordInput } from "../../../shared/src";
import { WordDoc, serializeWord, words } from "../db";

export const wordsRoute = new Hono();

// GET /api/words
// return the whole deck, newest first
// Searching and filtering are the client's job.
// both screens hold the full list in memory
wordsRoute.get("/", async (c) => {
  const all = await words.find({}).sort({ createdAt: -1 }).toArray();
  return c.json(all.map(serializeWord));
});

// POST /api/words
wordsRoute.post("/", async (c) => {
  const body = (await c.req.json()) as Partial<WordInput>;
  const error = validateInput(body);
  if (error) return c.json({ error }, 400);

  const chinese = body.chinese!.trim();
  const existing = await words.findOne({ chinese });
  if (existing) return c.json({ error: "already exists", word: serializeWord(existing) }, 409);

  const now = new Date();
  const doc: WordDoc = {
    _id: new ObjectId(),
    chinese,
    pinyin: body.pinyin!.trim(),
    english: body.english!.trim(),
    comments: body.comments?.trim() ?? "",
    learn_writing: body.learn_writing ?? false,
    facets: newFacets(now),
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
  for (const field of ["chinese", "pinyin", "english", "comments"] as const) {
    if (typeof body[field] === "string") $set[field] = body[field]!.trim();
  }
  if (typeof body.learn_writing === "boolean") $set.learn_writing = body.learn_writing;
  if (body.resetProgress) {
    $set.facets = newFacets(new Date());
  } else if (body.unsuspend) {
    // Reactivate a leech: clear the suspend flag on every facet. The lapse that
    // suspended a facet reset it to due-now, so it returns to the queue immediately.
    // Mongo interprets the dot as a path into subdocuments
    for (const d of FACETS) $set[`facets.${d}.suspended`] = false;
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

//#region helpers

// A fresh card knows none of its three facets. Reading and writing stay locked
// until meaning has held (see isFacetUnlocked), then come up as new cards.
function newFacets(now: Date): Record<Facet, Srs> {
  return { meaning: newSrs(now), reading: newSrs(now), writing: newSrs(now) };
}

function validateInput(body: Partial<WordInput>): string | null {
  if (!body.chinese?.trim()) return "chinese is required";
  if (!body.pinyin?.trim()) return "pinyin is required";
  if (!body.english?.trim()) return "english is required";
  return null;
}

//#endregion
