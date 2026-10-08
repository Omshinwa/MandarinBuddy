import {
  addDays,
  type Facet,
  FACETS,
  isDue,
  isFacetUnlocked,
  newSrs,
  type ReviewItem,
  type Srs,
  type Word,
  type WordInput,
} from "../../shared/src";

const DAY_MS = 24 * 60 * 60 * 1000;

// A facet can only be asked if the fields it needs are filled in.
export function facetAnswerable(w: Pick<WordInput, "chinese" | "pinyin" | "english">, d: Facet): boolean {
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

export interface QueueOptions {
  now: Date;
  dayStart: Date; // start of the user's review day (see reviewDayStart)
  enabled: readonly Facet[]; // facets not set to "None" in Settings
  batchSize: number;
}

// The review queue: at most one item per word, so the session count is never
// more than the number of words. A facet can be served when it's enabled,
// answerable, unlocked, not a leech, and due; of those, the earliest due wins.
// Bury (like Anki): once any facet of a word was answered today, its siblings
// wait for tomorrow — seeing 我 for its reading would give its writing away.
// The answered facet itself can still come back (a forgotten one is due again).
export function buildQueue(words: Word[], { now, dayStart, enabled, batchSize }: QueueOptions): ReviewItem[] {
  const dayStartIso = dayStart.toISOString();
  const items = words.flatMap((w): ReviewItem[] => {
    const answeredToday = FACETS.filter((d) => (w.facets[d].lastReviewed ?? "") >= dayStartIso);
    const meaningGates = enabled.includes("meaning") && facetAnswerable(w, "meaning");
    const servable = enabled.filter((d) => {
      const srs = w.facets[d];
      return (
        facetAnswerable(w, d) &&
        isFacetUnlocked(w, d, meaningGates) &&
        !srs.suspended &&
        isDue(srs, now) &&
        (answeredToday.length === 0 || answeredToday.includes(d))
      );
    });
    if (servable.length === 0) return [];
    const facet = servable.reduce((best, d) => (w.facets[d].due < w.facets[best].due ? d : best));
    return [{ word: w, facet }];
  });

  // Weakest (shortest-interval) first.
  const srsOf = (item: ReviewItem) => item.word.facets[item.facet];
  items.sort(
    (a, b) => srsOf(a).intervalDays - srsOf(b).intervalDays || srsOf(a).due.localeCompare(srsOf(b).due),
  );

  // Regroup into runs of up to `batchSize` per question type so consecutive
  // cards share an input method — typing pinyin and typing hanzi need different
  // keyboards, and switching per card is a pain. Weakest-first order is preserved
  // within each type. The types themselves are ordered by whichever holds the
  // weakest (shortest-interval) card, so a session opens on your weakest facet
  // instead of always leading with "meaning". Since `items` is already
  // weakest-first, each pool's first item is its minimum interval.
  const pools = FACETS.map((d) => items.filter((item) => item.facet === d))
    .filter((pool) => pool.length > 0)
    .sort((a, b) => srsOf(a[0]).intervalDays - srsOf(b[0]).intervalDays);
  const batched: ReviewItem[] = [];
  while (batched.length < items.length)
    for (const pool of pools) batched.push(...pool.splice(0, batchSize));
  return batched;
}

// Before facets had their own schedules, a word had one `srs` and each facet
// only a 0–8 `strength` that picked which question to ask.
export interface LegacyFacetState {
  strength: number;
  asked: number;
}

// One-off conversion to one schedule per facet. Each facet gets the word's
// interval scaled by its strength against the word's strongest facet: the
// strongest keeps it whole, a 0-strength facet starts over as a new card. If
// every strength is 0 there's nothing to rank by, so all keep it. Lapses restart
// at 0, except on a leech, which stays suspended on every facet until reactivated.
// `lastReviewed` is set on all three so existing words stay fully unlocked.
export function migrateFacets(
  srs: Srs,
  old: Partial<Record<Facet, LegacyFacetState>> | undefined,
  now: Date,
): Record<Facet, Srs> {
  const strength = (d: Facet) => old?.[d]?.strength ?? 0;
  const max = Math.max(...FACETS.map(strength));
  // When the word was last graded: its due date minus the interval that set it.
  const lastReview = new Date(
    Math.min(Date.parse(srs.due) - srs.intervalDays * DAY_MS, now.getTime()),
  );
  const leech = srs.suspended === true;
  const out = {} as Record<Facet, Srs>;
  for (const d of FACETS) {
    const ratio = max === 0 ? 1 : strength(d) / max;
    const interval = Math.round(srs.intervalDays * ratio * 10) / 10;
    const base: Srs =
      ratio === 0
        ? newSrs(now)
        : {
            ...srs,
            intervalDays: interval,
            due: ratio === 1 ? srs.due : addDays(lastReview, interval),
          };
    out[d] = {
      ...base,
      lapses: leech ? srs.lapses : 0,
      suspended: leech,
      lastReviewed: lastReview.toISOString(),
    };
  }
  return out;
}
