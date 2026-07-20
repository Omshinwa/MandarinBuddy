import { DIRECTIONS, type Direction, type Facet, type Grade, type Srs } from "./types";

// Every scheduling tuning constant lives here — adjust behavior in one place.
export const TUNING = {
  startEase: 2.5,
  minEase: 1.3,
  forgotEasePenalty: 0.2,
  hardMultiplier: 1.2, // "Hard": interval grows a little, not by ease
  hardEasePenalty: 0.15,
  easyBonus: 1.3, // "Easy": interval × ease × bonus
  easyEaseBonus: 0.15,
  easyMinDays: 4, // "Easy" on a brand-new card jumps straight to 4 days (like Anki)
  conversationGrowth: 1.3, // interval multiplier for conversation_used
  conversationCapDays: 15, // max days a single conversation credit can add
  conversationMinDays: 1, // a word used in conversation is never due sooner than tomorrow
  missedDivisor: 2, // conversation_missed halves the interval
  leechThreshold: 8, // Anki default: after this many lapses a card is a "leech" and gets suspended
  // How hard the question picker leans on the weakest facet. Higher = a weak
  // facet is asked more times before a stronger one gets a turn.
  facetBias: 2,
  strengthCap: 8, // ceiling on a facet's mastery level
};

// One knob for the review session's rhythm: how many of the same question type
// are served back-to-back (queue batching, so you're not switching keyboards
// every card) AND how many cards between celebration overlays. Kept equal so a
// party tends to land right as you finish a batch and switch exercise type.
// Change this single number (e.g. to 15) to move both together.
export const REVIEW_BATCH = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

export function newSrs(now: Date, intervalDays = 0, dueOffsetDays = 0): Srs {
  return {
    due: addDays(now, intervalDays + dueOffsetDays),
    intervalDays,
    ease: TUNING.startEase,
    lapses: 0,
    suspended: false,
  };
}

// A fresh card knows none of its three facets.
export function newFacets(): Record<Direction, Facet> {
  return {
    meaning: { strength: 0, asked: 0 },
    reading: { strength: 0, asked: 0 },
    writing: { strength: 0, asked: 0 },
  };
}

// A review answer moves the asked facet's mastery: forgot drops it, hard holds,
// remembered/easy raise it. Bounded to [0, strengthCap].
export function bumpStrength(strength: number, grade: Grade): number {
  const delta =
    grade === "reviewed_forgot" || grade === "conversation_missed"
      ? -1
      : grade === "reviewed_hard"
        ? 0
        : grade === "reviewed_easy"
          ? 2
          : 1; // reviewed_remembered / conversation_used
  return Math.max(0, Math.min(TUNING.strengthCap, strength + delta));
}

// Deterministic weighted picker: score = asked + facetBias·strength, lowest wins
// (ties resolve in DIRECTIONS order). A weak facet (low strength) is asked most,
// but every ask raises its `asked`, so neglected stronger facets still resurface.
// `allowed` restricts the pick to a subset — the caller passes only the facets
// that are enabled in Settings and answerable from the card's fields — and must
// be non-empty.
export function pickFacet(
  facets: Record<Direction, Facet>,
  allowed: readonly Direction[] = DIRECTIONS,
): Direction {
  const score = (f: Facet) => f.asked + TUNING.facetBias * f.strength;
  return allowed.reduce((best, d) => (score(facets[d]) < score(facets[best]) ? d : best), allowed[0]);
}

// Apply a review answer to the asked facet: its mastery moves via bumpStrength,
// its rotation counter bumps, and all counters are re-based to keep them small
// (subtracting a constant from every `asked` preserves the order the picker uses).
export function recordFacetAnswer(
  facets: Record<Direction, Facet>,
  asked: Direction,
  grade: Grade,
): Record<Direction, Facet> {
  const bumped = {
    ...facets,
    [asked]: { strength: bumpStrength(facets[asked].strength, grade), asked: facets[asked].asked + 1 },
  };
  const minAsked = Math.min(...DIRECTIONS.map((d) => bumped[d].asked));
  const rebased = {} as Record<Direction, Facet>;
  for (const d of DIRECTIONS) rebased[d] = { ...bumped[d], asked: bumped[d].asked - minAsked };
  return rebased;
}

// Anki-style leech detection: a card becomes a leech when its lapse count first
// reaches the threshold, then again after each additional half-threshold of
// lapses (8, 12, 16, …). Used to decide when a lapse should suspend the card.
export function isLeechMilestone(lapses: number, threshold = TUNING.leechThreshold): boolean {
  if (threshold <= 0 || lapses < threshold) return false;
  const step = Math.max(1, Math.ceil(threshold / 2));
  return (lapses - threshold) % step === 0;
}

export function isSuspended(srs: Srs): boolean {
  return srs.suspended === true;
}

const round1 = (n: number) => Math.round(n * 10) / 10; // intervals: 1 decimal
const round2 = (n: number) => Math.round(n * 100) / 100; // ease: 2 decimals (steps of 0.15)

export function applyGrade(srs: Srs, grade: Grade, now: Date): Srs {
  switch (grade) {
    case "reviewed_remembered": {
      const interval = round1(Math.max(1, srs.intervalDays * srs.ease));
      return { ...srs, intervalDays: interval, due: addDays(now, interval) };
    }
    case "reviewed_forgot": {
      const lapses = srs.lapses + 1;
      return {
        ...srs,
        lapses,
        ease: round2(Math.max(TUNING.minEase, srs.ease - TUNING.forgotEasePenalty)),
        intervalDays: 0,
        due: now.toISOString(), // due immediately → re-shown this session
        // Enough lapses → the card is a leech: suspend it (stop nagging you until
        // you reformulate it). An already-suspended card stays suspended.
        suspended: srs.suspended || isLeechMilestone(lapses),
      };
    }
    case "reviewed_hard": {
      // Barely recalled: small interval growth, and the card gets harder (ease drops).
      const interval = round1(Math.max(1, srs.intervalDays * TUNING.hardMultiplier));
      return {
        ...srs,
        ease: round2(Math.max(TUNING.minEase, srs.ease - TUNING.hardEasePenalty)),
        intervalDays: interval,
        due: addDays(now, interval),
      };
    }
    case "reviewed_easy": {
      // Trivial recall: extra interval jump, and the card gets easier (ease rises).
      const interval = round1(
        Math.max(TUNING.easyMinDays, srs.intervalDays * srs.ease * TUNING.easyBonus),
      );
      return {
        ...srs,
        ease: round2(srs.ease + TUNING.easyEaseBonus),
        intervalDays: interval,
        due: addDays(now, interval),
      };
    }
    case "conversation_used": {
      const grown = Math.min(
        srs.intervalDays * TUNING.conversationGrowth,
        srs.intervalDays + TUNING.conversationCapDays,
      );
      const interval = round1(Math.max(TUNING.conversationMinDays, grown));
      return { ...srs, intervalDays: interval, due: addDays(now, interval) };
    }
    case "conversation_missed": {
      const interval = round1(srs.intervalDays / TUNING.missedDivisor);
      return { ...srs, intervalDays: interval, due: now.toISOString() };
    }
  }
}

// ISO strings compare lexicographically in chronological order.
export function isDue(srs: Srs, now: Date): boolean {
  return srs.due <= now.toISOString();
}

// Whether a card is still "young" and should be reviewed with scaffolding
// (pinyin/audio). `maxIntervalDays` is the cutoff — a client-side presentation
// knob, so it's passed in rather than baked into the scheduling TUNING.
export function isScaffolded(srs: Srs, maxIntervalDays: number): boolean {
  return srs.intervalDays < maxIntervalDays;
}

// Words this well-established are effectively permanent — highlighting them in
// chat just clutters the message (and a stray tap costs a conversation_missed),
// so they're left un-glossed. Below this interval a word can still slip, so it
// stays glossable.
export const GLOSS_MAX_INTERVAL_DAYS = 90;

export function isGlossable(srs: Srs): boolean {
  return srs.intervalDays < GLOSS_MAX_INTERVAL_DAYS;
}

// Interval buckets for color-coding; palette carried over from the old site.
export const BUCKETS = [
  { maxDays: 1, color: "#ffffff", label: "new" },
  { maxDays: 3, color: "#ddc1ff", label: "1–3d" },
  { maxDays: 7, color: "#99e9fa", label: "3–7d" },
  { maxDays: 14, color: "#91ffc0", label: "1–2w" },
  { maxDays: 30, color: "#fffaab", label: "2–4w" },
  { maxDays: 90, color: "#ffcf9d", label: "1–3mo" },
  { maxDays: Infinity, color: "#f5a3a3", label: "3mo+" },
];

export function intervalBucket(intervalDays: number): number {
  const i = BUCKETS.findIndex((b) => intervalDays < b.maxDays);
  return i === -1 ? BUCKETS.length - 1 : i;
}
