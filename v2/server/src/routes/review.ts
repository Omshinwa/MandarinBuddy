import { Hono } from "hono";
import { ObjectId } from "mongodb";
import { REVIEW_BATCH, applyGrade, newFacets, pickFacet, recordFacetAnswer } from "../../../shared/src/srs";
import { DIRECTIONS } from "../../../shared/src/types";
import type { Direction, Grade } from "../../../shared/src/types";
import { serializeWord, words } from "../db";

export const reviewRoute = new Hono();

const GRADES: Grade[] = [
  "reviewed_remembered",
  "reviewed_forgot",
  "reviewed_hard",
  "reviewed_easy",
  "conversation_used",
  "conversation_missed",
];

// GET /api/review/queue
// One item per due card. Each card has a single schedule; the question type is
// chosen by the weighted facet picker (weakest facet most often, strong facets
// still revisited). Weakest words (shortest interval) come first.
reviewRoute.get("/queue", async (c) => {
  const nowIso = new Date().toISOString();
  const all = await words.find({ srs: { $exists: true } }).toArray();

  // Client-chosen batch size (Settings → Review batch size); falls back to the
  // shared default for old clients. Clamped to ≥1 so the batching loop below
  // always makes progress (a size of 0 would splice nothing and spin forever).
  const batchParam = Number(c.req.query("batch"));
  const batchSize = Number.isInteger(batchParam) && batchParam >= 1 ? batchParam : REVIEW_BATCH;

  const items = all
    .filter((w) => w.srs!.due <= nowIso && !w.srs!.suspended)
    .map((w) => ({
      word: serializeWord(w),
      direction: pickFacet(w.facets ?? newFacets()),
    }));

  items.sort(
    (a, b) =>
      a.word.srs.intervalDays - b.word.srs.intervalDays ||
      a.word.srs.due.localeCompare(b.word.srs.due),
  );

  // Regroup into runs of up to REVIEW_BATCH per question type so consecutive
  // cards share an input method — typing pinyin and typing hanzi need different
  // keyboards, and switching per card is a pain. Weakest-first order is preserved
  // within each type. The types themselves are ordered by whichever holds the
  // weakest (shortest-interval) card, so a session opens on your weakest facet
  // instead of always leading with "meaning". Since `items` is already
  // weakest-first, each pool's first item is its minimum interval.
  const pools = DIRECTIONS.map((d) => items.filter((item) => item.direction === d))
    .filter((pool) => pool.length > 0)
    .sort((a, b) => a[0].word.srs.intervalDays - b[0].word.srs.intervalDays);
  const batched: typeof items = [];
  while (batched.length < items.length)
    for (const pool of pools) batched.push(...pool.splice(0, batchSize));
  return c.json(batched);
});

// POST /api/review/grade  — body {wordId, direction, grade}
// The grade drives the card's single schedule; `direction` is the facet that was
// asked, whose mastery (and rotation counter) moves so the next ask can differ.
reviewRoute.post("/grade", async (c) => {
  const body = (await c.req.json()) as { wordId?: string; direction?: Direction; grade?: Grade };
  if (!body.wordId || !ObjectId.isValid(body.wordId)) return c.json({ error: "bad wordId" }, 400);
  if (!body.direction || !DIRECTIONS.includes(body.direction))
    return c.json({ error: "bad direction" }, 400);
  if (!body.grade || !GRADES.includes(body.grade)) return c.json({ error: "bad grade" }, 400);

  const word = await words.findOne({ _id: new ObjectId(body.wordId) });
  if (!word?.srs) return c.json({ error: "not found" }, 404);

  const next = applyGrade(word.srs, body.grade, new Date());
  const facets = recordFacetAnswer(word.facets ?? newFacets(), body.direction, body.grade);
  const result = await words.findOneAndUpdate(
    { _id: word._id },
    { $set: { srs: next, facets, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return c.json(serializeWord(result!));
});
