
// :::::::::     :::     :::::::::   ::::::::  :::::::::: 
// :+:    :+:  :+: :+:   :+:    :+: :+:    :+: :+:        
// +:+    +:+ +:+   +:+  +:+    +:+ +:+        +:+        
// +#++:++#+ +#++:++#++: +#++:++#:  +#++:++#++ +#++:++#   
// +#+       +#+     +#+ +#+    +#+        +#+ +#+        
// #+#       #+#     #+# #+#    #+# #+#    #+# #+#        
// ###       ###     ### ###    ###  ########  ########## 

// Tones 1–4 for each pinyin vowel, indexed by tone number - 1.
const TONE_MARKS: Record<string, string> = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ",
  A: "ĀÁǍÀ", E: "ĒÉĚÈ", I: "ĪÍǏÌ", O: "ŌÓǑÒ", U: "ŪÚǓÙ", Ü: "ǕǗǙǛ",
};

// A syllable's vowels, an optional final n / ng / r, then the tone number.
const NUMBERED_SYLLABLE = /([aeiouüv]+)(ng|n|r)?([1-4])/gi;

/**
 * Typing aid for pinyin answers: a tone number at the end of a syllable puts
 * the mark on the right vowel — "hao3" → hǎo, "zhuang4" → zhuàng. Typing the
 * number straight after a vowel works too ("a1" → ā, "ha3o" → hǎo). `v` stands
 * in for ü ("nv3" → nǚ), since most keyboards have no ü key.
 *
 * Which vowel gets the mark (the standard rule):
 * 1. a or e, if there is one       — hǎo, xiǎn, lüè
 * 2. otherwise the o of "ou"        — gǒu
 * 3. otherwise the last vowel       — guó, liú, guì
 */
export function numberedToToneMarks(s: string): string {
  return s.replace(NUMBERED_SYLLABLE, (_, vowels: string, final = "", n: string) => {
    const v = vowels.replace(/v/g, "ü").replace(/V/g, "Ü");
    const lower = v.toLowerCase();
    let i = lower.search(/[ae]/);
    if (i < 0) i = lower.indexOf("ou");
    if (i < 0) i = v.length - 1;
    return v.slice(0, i) + TONE_MARKS[v[i]][Number(n) - 1] + v.slice(i + 1) + final;
  });
}

// match circumflex vowels: â -> ǎ
const CIRCUMFLEX: Record<string, string> = { â: "ǎ", î: "ǐ", ô: "ǒ", û: "ǔ" };
// match 2nd tone to 3rd tone: á -> ǎ
const TONECOLLAPSE: Record<string, string> = { á: "ǎ", é: "ě", í: "ǐ", ó: "ǒ", ú: "ǔ", ǘ: "ǚ" };

/**
 * Folding pass, shared by answer matching and the word search.
 *
 * Always remove case, circumflex vowels as 3rd tone (â → ǎ),
 * remove punctuation
 * 
 * So "图书馆" matches 图<书>馆 and "to eat to have" matches "to eat, to have (a meal)".
 *
 * options:
 * - `fuzzy`    collapses the 2nd and 3rd tones onto one, for typed pinyin.
 * - `toneless` drops tone marks entirely (NFD splits an accented letter into base
 *            + combining marks, which then get stripped), so "ai" finds "ài".
 *            for Search-only.
 */
export function normalizeText(s: string, fuzzy = false, toneless = false): string {
  let out = s.toLowerCase().replace(/[âîôû]/g, (c) => CIRCUMFLEX[c]);
  if (toneless) out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  else if (fuzzy) out = out.replace(/[áéíóúǘ]/g, (c) => TONECOLLAPSE[c]);
  // \p{M} kept so decomposed pinyin (u + ̌) holds on to its tone.
  return out.replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

// ::::::::::: :::    ::: :::::::::   ::::::::  :::::::::: 
//     :+:     :+:    :+: :+:    :+: :+:    :+: :+:        
//     +:+     +:+    +:+ +:+    +:+ +:+        +:+        
//     +#+     +#+    +:+ +#+    +:+ :#:        +#++:++#   
//     +#+     +#+    +#+ +#+    +#+ +#+   +#+# +#+        
// #+# #+#     #+#    #+# #+#    #+# #+#    #+# #+#        
//  #####       ########  #########   ########  ########## 

/**
 * How a typed guess scored:
 * - `match`  — accepted.
 * - `partial` — the guess IS inside the answer, but it's shorter than the
 *   leniency setting demands. 
 * - `miss`   — the guess doesn't appear in the answer at all.
 */
export type MatchVerdict = "match" | "partial" | "miss";

/**
 * Lenient match: the typed guess passes if it appears anywhere inside
 * the expected string, once both sides are normalized.
 *
 * `minLen` is the input-leniency knob
 * Default 1 = the original behaviour (any non-empty substring passes).
 * Pass Infinity to demand an exact, whole-answer match.
 */
export function lenientVerdict(
  expected: string,
  guess: string,
  fuzzy = false,
  minLen = 1,
): MatchVerdict {
  const sol = normalizeText(expected, fuzzy);
  const g = normalizeText(guess, fuzzy);
  if (!g || !sol.includes(g)) return "miss";
  return g.length >= Math.min(minLen, sol.length) ? "match" : "partial";
}
