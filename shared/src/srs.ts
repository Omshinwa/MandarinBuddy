import type { Facet, Grade, Srs, Word } from "./word";

// Every tuning constant the scheduler leans on.
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
  unlockAfterDays: 7, // reading/writing unlock once meaning's interval reaches this
  dayRolloverHour: 4, // a review day starts at 4am local (like Anki), so late nights count as the day before
};

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

// Anki-style leech detection: a card becomes a leech when its lapse count first
// reaches the threshold, then again after each additional half-threshold of
// lapses (8, 12, 16, …). Used to decide when a lapse should suspend the card.
export function isLeechMilestone(lapses: number, threshold = TUNING.leechThreshold): boolean {
  if (threshold <= 0 || lapses < threshold) return false;
  const step = Math.max(1, Math.ceil(threshold / 2));
  return (lapses - threshold) % step === 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10; // intervals: 1 decimal
const round2 = (n: number) => Math.round(n * 100) / 100; // ease: 2 decimals (steps of 0.15)

// app runs it locally to preview intervals
export function applyGrade(srs: Srs, grade: Grade, now: Date): Srs {
  switch (grade) {
    case "reviewed_okay": {
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

// A new word starts with meaning only; reading and writing unlock once meaning
// has held for `unlockAfterDays`. A facet that has been reviewed once stays
// unlocked even if meaning lapses later. `meaningGates` is false when meaning
// can't be asked (set to None, or the card lacks the fields) — then nothing
// would ever unlock the others, so they're open from the start.
export function isFacetUnlocked(
  word: Pick<Word, "facets">,
  facet: Facet,
  meaningGates = true,
): boolean {
  if (facet === "meaning" || !meaningGates) return true;
  return (
    word.facets[facet].lastReviewed !== undefined ||
    word.facets.meaning.intervalDays >= TUNING.unlockAfterDays
  );
}

// Start of the current review day in the device's local time: today at the
// rollover hour, or yesterday's if it's earlier than that. Call it on the app —
// the server runs in UTC and doesn't know the user's timezone.
export function reviewDayStart(now: Date): Date {
  const start = new Date(now);
  start.setHours(TUNING.dayRolloverHour, 0, 0, 0);
  if (start > now) start.setDate(start.getDate() - 1);
  return start;
}

// Whether a card is still "young" and should be reviewed with scaffolding
// (pinyin/audio). `maxIntervalDays` is the cutoff
export function isScaffolded(srs: Srs, maxIntervalDays: number): boolean {
  return srs.intervalDays < maxIntervalDays;
}

// Words this well-established are effectively permanent — highlighting them in
// chat just clutters the message (and a stray tap costs a conversation_missed),
// so they're left un-glossed.
export const GLOSS_MAX_INTERVAL_DAYS = 90;

export function isGlossable(srs: Srs): boolean {
  return srs.intervalDays < GLOSS_MAX_INTERVAL_DAYS;
}
