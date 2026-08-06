// Levels used to be stored on each word as `level_id`. They aren't anymore —
// they're derived from the SRS interval that v2 keeps on every word (srs.intervalDays).
//
// The mapping is the one the old scheduler already implied: yaquoi() in
// client/src/index.js studies level L every 2^(L-1) days (L1 daily, L2 every 2
// days, L3 every 4 … L7 every 64). So a word's level is just which octave of the
// interval it sits in:
//
//   L1 [0, 2)     L2 [2, 4)      L3 [4, 8)       L4 [8, 16)     L5 [16, 32)
//   L6 [32, 64)   L7 [64, 128)   L8 [128, 256)   L9 [256, ∞)
//
// L1 swallowing interval 0 keeps the old semantics exactly: giving up sends a
// word back to level 1, and v2's "forgot" grade sets the interval to 0.
//
// L9 is never scheduled by yaquoi(), which is also unchanged from before — it
// stays the retirement bucket for words you've genuinely finished with.

const MIN_LEVEL = 1;
const MAX_LEVEL = 9;

function clampLevel(level) {
  const l = Math.round(Number(level));
  if (!Number.isFinite(l)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, l));
}

// The interval a word is snapped to on arriving at `level`. Level 1 is 0, not 1,
// so a word knocked back down is due immediately — same as v2's "forgot".
function intervalForLevel(level) {
  const l = clampLevel(level);
  return l === MIN_LEVEL ? 0 : Math.pow(2, l - 1);
}

// Inverse of intervalForLevel. v2's intervals are continuous (interval × ease),
// so this floors to the octave rather than expecting an exact power of two.
function levelForInterval(intervalDays) {
  const i = Number(intervalDays);
  if (!Number.isFinite(i) || i < 2) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, 1 + Math.floor(Math.log2(i)));
}

// The [lo, hi) interval window holding a level's words. `hi` is null at the top
// level, which is open-ended.
function intervalRangeForLevel(level) {
  const l = clampLevel(level);
  return {
    lo: l === MIN_LEVEL ? 0 : Math.pow(2, l - 1),
    hi: l === MAX_LEVEL ? null : Math.pow(2, l),
  };
}

// A Mongo query fragment matching every word at `level`. Words with no `srs` at
// all can't be placed on the ladder, and $gte excludes them for free.
function intervalQueryForLevel(level) {
  const { lo, hi } = intervalRangeForLevel(level);
  return hi === null ? { $gte: lo } : { $gte: lo, $lt: hi };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// v2 stores `srs.due` as an ISO string (it compares them lexicographically).
function dueAfter(intervalDays, now = new Date()) {
  return new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
}

module.exports = {
  MIN_LEVEL,
  MAX_LEVEL,
  clampLevel,
  intervalForLevel,
  levelForInterval,
  intervalRangeForLevel,
  intervalQueryForLevel,
  dueAfter,
};
