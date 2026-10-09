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
import { buildQueue } from "../facets";
import { serializeWord, words } from "../db";

export const reviewRoute = new Hono();

const HOUR_MS = 60 * 60 * 1000;

// GET /api/review/queue
// At most one item per due word — each facet has its own schedule, and
// buildQueue picks which one to ask (and buries the rest once one was answered
// today). Oldest-due facets come first, grouped into runs per question type.
reviewRoute.get("/queue", async (c) => {
  const now = new Date();
  const all = await words.find({}).toArray();

  // Client-chosen batch size (Settings → Review batch size); falls back to the
  // shared default for old clients. Clamped to ≥1 so the batching loop in
  // buildQueue always makes progress (a size of 0 would splice nothing and spin forever).
  const batchParam = Number(c.req.query("batch"));
  const batchSize = Number.isInteger(batchParam) && batchParam >= 1 ? batchParam : REVIEW_BATCH;

  // Facets the client will actually test — the ones NOT set to "None" in
  // Settings, sent as a comma-separated list. Old clients omit it, so default to
  // all three facets.
  const dirParam = c.req.query("facets");
  const enabled: Facet[] = dirParam
    ? (dirParam.split(",").filter((d) => FACETS.includes(d as Facet)) as Facet[])
    : FACETS;

  // Start of the user's review day, computed on the device (the server doesn't
  // know its timezone). Without one, "today" is the last 12 hours.
  const dayParam = new Date(c.req.query("dayStart") ?? "");
  const dayStart = isNaN(dayParam.getTime()) ? new Date(now.getTime() - 12 * HOUR_MS) : dayParam;

  return c.json(buildQueue(all.map(serializeWord), { now, dayStart, enabled, batchSize }));
});

// POST /api/review/grade  — body {wordId, facet, grade}
// The grade moves only the asked facet's schedule. A review answer also stamps
// `lastReviewed`, which unlocks the facet for good and buries its siblings for
// the rest of the day; chat grades (conversation_missed) don't.
reviewRoute.post("/grade", async (c) => {
  const body = (await c.req.json()) as { wordId?: string; facet?: Facet; grade?: Grade };
  if (!body.wordId || !ObjectId.isValid(body.wordId)) return c.json({ error: "bad wordId" }, 400);
  if (!body.facet || !FACETS.includes(body.facet))
    return c.json({ error: "bad facet" }, 400);
  if (!body.grade || !GRADES.includes(body.grade)) return c.json({ error: "bad grade" }, 400);

  const word = await words.findOne({ _id: new ObjectId(body.wordId) });
  if (!word?.facets) return c.json({ error: "not found" }, 404);

  const now = new Date();
  const next = applyGrade(word.facets[body.facet], body.grade, now);
  if (body.grade.startsWith("reviewed_")) next.lastReviewed = now.toISOString();
  const result = await words.findOneAndUpdate(
    { _id: word._id },
    { $set: { [`facets.${body.facet}`]: next, updatedAt: now } },
    { returnDocument: "after" },
  );
  return c.json(serializeWord(result!));
});
