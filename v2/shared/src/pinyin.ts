// Tone-marked vowel → [base letter, tone number]. ü is written as v (IME convention).
const TONE_MARKS: Record<string, [string, number]> = {
  ā: ["a", 1], á: ["a", 2], ǎ: ["a", 3], à: ["a", 4],
  ē: ["e", 1], é: ["e", 2], ě: ["e", 3], è: ["e", 4],
  ī: ["i", 1], í: ["i", 2], ǐ: ["i", 3], ì: ["i", 4],
  ō: ["o", 1], ó: ["o", 2], ǒ: ["o", 3], ò: ["o", 4],
  ū: ["u", 1], ú: ["u", 2], ǔ: ["u", 3], ù: ["u", 4],
  ǖ: ["v", 1], ǘ: ["v", 2], ǚ: ["v", 3], ǜ: ["v", 4],
  ü: ["v", 0],
};

export interface PinyinAnalysis {
  letters: string; // lowercase letters only, tone marks flattened, ü → v
  tones: number[]; // tone digits in order (neutral tone omitted)
}

export function analyzePinyin(input: string): PinyinAnalysis {
  let letters = "";
  const tones: number[] = [];
  for (const ch of input.normalize("NFC").toLowerCase()) {
    const marked = TONE_MARKS[ch];
    if (marked) {
      letters += marked[0];
      if (marked[1] > 0) tones.push(marked[1]);
    } else if (ch >= "1" && ch <= "5") {
      if (ch !== "5") tones.push(Number(ch)); // 5 = neutral tone, ignored
    } else if (ch >= "a" && ch <= "z") {
      letters += ch;
    }
    // spaces, apostrophes and punctuation are ignored
  }
  return { letters, tones };
}

/**
 * Compare typed pinyin against the stored pinyin. Tones are always required, and
 * the base letters must match exactly. In fuzzy mode the 2nd and 3rd tones are
 * accepted interchangeably (the pair learners most often confuse) — 1 and 4 must
 * still be exact. Off = every tone must match exactly.
 * Accepts tone marks (tuījiàn) or tone numbers (tui1jian4); spacing/case-insensitive.
 */
export function pinyinMatches(expected: string, answer: string, fuzzy: boolean): boolean {
  const e = analyzePinyin(expected);
  const a = analyzePinyin(answer);
  if (e.letters.length === 0 || e.letters !== a.letters) return false;
  // Fuzzy: collapse tone 3 into 2 so the two are treated as the same.
  const key = (tones: number[]) => tones.map((n) => (fuzzy && n === 3 ? 2 : n)).join("");
  return key(e.tones) === key(a.tones);
}

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
