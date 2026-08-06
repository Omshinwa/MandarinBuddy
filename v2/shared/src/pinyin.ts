// French / dead-key keyboards produce circumflex vowels (â î ô û) where pinyin
// wants the 3rd-tone carons (ǎ ǐ ǒ ǔ) — read them as the same character.
const CIRCUMFLEX: Record<string, string> = { â: "ǎ", î: "ǐ", ô: "ǒ", û: "ǔ" };

// Fuzzy: fold the 2nd and 3rd tones (the pair learners confuse most) onto one
// caron so they compare equal. Applied to both the guess and the answer.
function collapseFuzzyTones(s: string): string {
  return s
    .replaceAll("á", "ǎ")
    .replaceAll("é", "ě")
    .replaceAll("í", "ǐ")
    .replaceAll("ó", "ǒ")
    .replaceAll("ú", "ǔ")
    .replaceAll("ǘ", "ǚ");
}

// Only letters, digits and combining marks carry meaning in an answer. Drop
// everything else — whitespace, punctuation (, . " ' / …), the '<>' emphasis
// markers cards use — from both sides so they never decide a match. Combining
// marks stay so decomposed pinyin (u + ̌ ) keeps its tone.
const NOISE_RE = /[^\p{L}\p{N}\p{M}]/gu;

// Everything a comparison should ignore, in one place: case, noise, and the tone
// spellings that count as the same sound. Case-folding comes first so the tone
// tables (all lowercase) never miss an uppercase vowel. Applied to both sides of
// every match, so a fold can only make the comparison more forgiving, never
// stricter — which is why hanzi and English answers can run through it too.
function normalize(s: string, fuzzy = false): string {
  const clean = s.toLowerCase().replace(NOISE_RE, "");
  const folded = clean.replace(/[âîôû]/g, (c) => CIRCUMFLEX[c]);
  return fuzzy ? collapseFuzzyTones(folded) : folded;
}

/**
 * How a typed guess scored:
 * - `match`  — accepted.
 * - `partial` — the guess IS inside the answer, but it's shorter than the
 *   leniency setting demands. Worth telling the user apart from a plain miss:
 *   they're on the right track and only need more characters.
 * - `miss`   — the guess doesn't appear in the answer at all.
 */
export type MatchVerdict = "match" | "partial" | "miss";

/**
 * Lenient match: the typed guess passes if it appears anywhere inside
 * the expected string, once both sides are normalized.
 *
 * `minLen` is the input-leniency knob: the guess must be at least this many
 * meaningful characters, capped at the answer's own length so short answers stay
 * reachable. Default 1 = the original behaviour (any non-empty substring passes).
 * Pass Infinity to demand an exact, whole-answer match.
 */
function lenientVerdict(
  expected: string,
  guess: string,
  fuzzy = false,
  minLen = 1,
): MatchVerdict {
  const sol = normalize(expected, fuzzy);
  const g = normalize(guess, fuzzy);
  if (!g || !sol.includes(g)) return "miss";
  return g.length >= Math.min(minLen, sol.length) ? "match" : "partial";
}

// Reading answers (typed pinyin): substring match on the tone-marked pinyin,
// with circumflex vowels folded and — in fuzzy mode — 2nd/3rd tones collapsed.
// Syllable separators (spaces, apostrophes, hyphens) are noise and drop out.
export function pinyinVerdict(
  expected: string,
  guess: string,
  fuzzy: boolean,
  minLen = 1,
): MatchVerdict {
  return lenientVerdict(expected, guess, fuzzy, minLen);
}

// Writing (typed hanzi) and meaning (typed English) answers: substring match with
// no tone collapsing — there are no tones to confuse in hanzi or English.
export function answerVerdict(expected: string, guess: string, minLen = 1): MatchVerdict {
  return lenientVerdict(expected, guess, false, minLen);
}

// Pass/fail shorthands over the verdicts, for callers that don't care why.
export function pinyinContains(
  expected: string,
  guess: string,
  fuzzy: boolean,
  minLen = 1,
): boolean {
  return pinyinVerdict(expected, guess, fuzzy, minLen) === "match";
}

export function answerContains(expected: string, guess: string, minLen = 1): boolean {
  return answerVerdict(expected, guess, minLen) === "match";
}
