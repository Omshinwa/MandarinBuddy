import { Hono } from "hono";
import { ObjectId } from "mongodb";
import {
  applyGrade,
  type Facet,
  FACETS,
  type Grade,
  GRADES,
  REVIEW_BATCH,
} from "../../../shared/src";
import { pickFacet, recordFacetAnswer } from "../facets";
import { serializeWord, words, type WordDoc } from "../db";

export const reviewRoute = new Hono();

// A facet can only be asked if the fields it needs are filled in. 
function facetAnswerable(w: WordDoc, d: Facet): boolean {
  const has = (s?: string) => !!s && s.trim().length > 0;
  switch (d) {
    case "meaning":
      return has(w.chinese) && has(w.english);
    case "reading":
      return has(w.chinese) && has(w.pinyin);
    case "writing":
      return has(w.chinese) && has(w.english);
  }
}

// GET /api/review/queue
// One item per due card. Each card has a single schedule; the question type is
// chosen by the weighted facet picker (weakest facet most often, strong facets
// still revisited). Weakest words (shortest interval) come first.
reviewRoute.get("/queue", async (c) => {
  const nowIso = new Date().toISOString();
  const all = await words.find({}).toArray();

  // Client-chosen batch size (Settings → Review batch size); falls back to the
  // shared default for old clients. Clamped to ≥1 so the batching loop below
  // always makes progress (a size of 0 would splice nothing and spin forever).
  const batchParam = Number(c.req.query("batch"));
  const batchSize = Number.isInteger(batchParam) && batchParam >= 1 ? batchParam : REVIEW_BATCH;

  // Facets the client will actually test — the ones NOT set to "None" in
  // Settings, sent as a comma-separated list. Old clients omit it, so default to
  // all three facets.
  const dirParam = c.req.query("facets");
  const enabled: Facet[] = dirParam
    ? (dirParam.split(",").filter((d) => FACETS.includes(d as Facet)) as Facet[])
    : FACETS;

  const items = all
    .filter((w) => w.srs.due <= nowIso && !w.srs.suspended)
    .flatMap((w) => {
      // Only ask a facet that's both enabled in Settings and answerable from this
      // card's fields; a card with no eligible facet drops out of the queue.
      const eligible = enabled.filter((d) => facetAnswerable(w, d));
      if (eligible.length === 0) return [];
      return [{ word: serializeWord(w), facet: pickFacet(w.facets, eligible) }];
    });

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
  const pools = FACETS.map((d) => items.filter((item) => item.facet === d))
    .filter((pool) => pool.length > 0)
    .sort((a, b) => a[0].word.srs.intervalDays - b[0].word.srs.intervalDays);
  const batched: typeof items = [];
  while (batched.length < items.length)
    for (const pool of pools) batched.push(...pool.splice(0, batchSize));
  return c.json(batched);
});

// POST /api/review/grade  — body {wordId, facet, grade}
// The grade drives the card's single schedule; `facet` names the question type
// that was asked, whose mastery (and ask counter) moves so the next ask can differ.
reviewRoute.post("/grade", async (c) => {
  const body = (await c.req.json()) as { wordId?: string; facet?: Facet; grade?: Grade };
  if (!body.wordId || !ObjectId.isValid(body.wordId)) return c.json({ error: "bad wordId" }, 400);
  if (!body.facet || !FACETS.includes(body.facet))
    return c.json({ error: "bad facet" }, 400);
  if (!body.grade || !GRADES.includes(body.grade)) return c.json({ error: "bad grade" }, 400);

  const word = await words.findOne({ _id: new ObjectId(body.wordId) });
  if (!word?.srs) return c.json({ error: "not found" }, 404);

  const next = applyGrade(word.srs, body.grade, new Date());
  const facets = recordFacetAnswer(word.facets, body.facet, body.grade);
  const result = await words.findOneAndUpdate(
    { _id: word._id },
    { $set: { srs: next, facets, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return c.json(serializeWord(result!));
});
