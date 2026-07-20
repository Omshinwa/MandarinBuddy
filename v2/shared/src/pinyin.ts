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

/**
 * Lenient "old-site" match: the typed guess passes if it appears anywhere inside
 * the expected string (case-folded, whitespace ignored). `normalize` runs on both
 * sides first, letting pinyin fold circumflex vowels and optionally collapse tones.
 *
 * `minLen` is the input-leniency knob: the guess must be at least this many
 * characters, capped at the answer's own length so short answers stay reachable.
 * Default 1 = the original behaviour (any non-empty substring passes). Pass
 * Infinity to demand an exact, whole-answer match.
 */
function lenientContains(
  expected: string,
  guess: string,
  normalize: (s: string) => string = (s) => s,
  minLen = 1,
): boolean {
  const sol = normalize(expected.toLowerCase()).replace(/\s+/g, "");
  const g = normalize(guess.toLowerCase()).replace(/\s+/g, "");
  if (!g) return false;
  if (g.length < Math.min(minLen, sol.length)) return false;
  return sol.includes(g);
}

// Reading answers (typed pinyin): substring match on the tone-marked pinyin,
// with circumflex vowels folded and — in fuzzy mode — 2nd/3rd tones collapsed.
export function pinyinContains(
  expected: string,
  guess: string,
  fuzzy: boolean,
  minLen = 1,
): boolean {
  const norm = (s: string) => {
    const folded = s.replace(/[âîôû]/g, (c) => CIRCUMFLEX[c]);
    return fuzzy ? collapseFuzzyTones(folded) : folded;
  };
  return lenientContains(expected, guess, norm, minLen);
}

// Writing answers (typed hanzi): plain substring match, whitespace ignored.
export function answerContains(expected: string, guess: string, minLen = 1): boolean {
  return lenientContains(expected, guess, undefined, minLen);
}
