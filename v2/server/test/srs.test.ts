import { describe, expect, it } from "vitest";
import {
  answerContains,
  answerVerdict,
  pinyinContains,
  pinyinVerdict,
} from "../../shared/src/pinyin";
import {
  TUNING,
  applyGrade,
  bumpStrength,
  intervalBucket,
  isDue,
  isLeechMilestone,
  isScaffolded,
  isSuspended,
  newFacets,
  newSrs,
  pickFacet,
  recordFacetAnswer,
} from "../../shared/src/srs";
import type { Direction, Facet, Srs } from "../../shared/src/types";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const srsWith = (overrides: Partial<Srs>): Srs => ({
  due: NOW.toISOString(),
  intervalDays: 0,
  ease: TUNING.startEase,
  lapses: 0,
  ...overrides,
});

const daysUntilDue = (srs: Srs) => (new Date(srs.due).getTime() - NOW.getTime()) / DAY_MS;

describe("applyGrade", () => {
  it("remembered: new word goes to a 1-day interval", () => {
    const next = applyGrade(srsWith({ intervalDays: 0 }), "reviewed_remembered", NOW);
    expect(next.intervalDays).toBe(1);
    expect(daysUntilDue(next)).toBeCloseTo(1);
  });

  it("remembered: interval grows by ease", () => {
    const next = applyGrade(srsWith({ intervalDays: 4 }), "reviewed_remembered", NOW);
    expect(next.intervalDays).toBeCloseTo(10); // 4 × 2.5
    expect(daysUntilDue(next)).toBeCloseTo(10);
  });

  it("forgot: resets interval, penalizes ease, counts the lapse, due now", () => {
    const next = applyGrade(
      srsWith({ intervalDays: 20, ease: 2.5, lapses: 1 }),
      "reviewed_forgot",
      NOW,
    );
    expect(next.intervalDays).toBe(0);
    expect(next.ease).toBeCloseTo(2.3);
    expect(next.lapses).toBe(2);
    expect(next.due).toBe(NOW.toISOString());
  });

  it("forgot: ease never drops below the floor", () => {
    const next = applyGrade(srsWith({ ease: 1.35 }), "reviewed_forgot", NOW);
    expect(next.ease).toBe(TUNING.minEase);
  });

  it("hard: small growth, ease penalty, respects the ease floor", () => {
    const next = applyGrade(srsWith({ intervalDays: 10, ease: 2.5 }), "reviewed_hard", NOW);
    expect(next.intervalDays).toBeCloseTo(12); // 10 × 1.2
    expect(next.ease).toBeCloseTo(2.35);
    const floored = applyGrade(srsWith({ ease: 1.35 }), "reviewed_hard", NOW);
    expect(floored.ease).toBe(TUNING.minEase);
  });

  it("hard: a new card still moves to at least 1 day", () => {
    const next = applyGrade(srsWith({ intervalDays: 0 }), "reviewed_hard", NOW);
    expect(next.intervalDays).toBe(1);
  });

  it("easy: bonus growth and ease reward", () => {
    const next = applyGrade(srsWith({ intervalDays: 10, ease: 2.5 }), "reviewed_easy", NOW);
    expect(next.intervalDays).toBeCloseTo(32.5); // 10 × 2.5 × 1.3
    expect(next.ease).toBeCloseTo(2.65);
  });

  it("easy: a brand-new card jumps straight to 4 days", () => {
    const next = applyGrade(srsWith({ intervalDays: 0 }), "reviewed_easy", NOW);
    expect(next.intervalDays).toBe(TUNING.easyMinDays);
  });

  it("conversation_used: partial growth", () => {
    const next = applyGrade(srsWith({ intervalDays: 10 }), "conversation_used", NOW);
    expect(next.intervalDays).toBeCloseTo(13); // 10 × 1.3
  });

  it("conversation_used: growth capped at +15 days", () => {
    const next = applyGrade(srsWith({ intervalDays: 100 }), "conversation_used", NOW);
    expect(next.intervalDays).toBeCloseTo(115);
  });

  it("conversation_used: a brand-new word is pushed to tomorrow, not 0", () => {
    const next = applyGrade(srsWith({ intervalDays: 0 }), "conversation_used", NOW);
    expect(next.intervalDays).toBe(TUNING.conversationMinDays);
  });

  it("conversation_missed: halves the interval and is due now, no ease penalty", () => {
    const next = applyGrade(srsWith({ intervalDays: 10, ease: 2.5 }), "conversation_missed", NOW);
    expect(next.intervalDays).toBe(5);
    expect(next.ease).toBe(2.5);
    expect(isDue(next, NOW)).toBe(true);
  });
});

describe("leeches", () => {
  it("isLeechMilestone fires at the threshold, then every half-threshold", () => {
    expect(isLeechMilestone(7)).toBe(false);
    expect(isLeechMilestone(8)).toBe(true); // threshold
    expect(isLeechMilestone(9)).toBe(false);
    expect(isLeechMilestone(11)).toBe(false);
    expect(isLeechMilestone(12)).toBe(true); // +4 (half of 8)
    expect(isLeechMilestone(16)).toBe(true);
  });

  it("the 8th forgot suspends the card as a leech", () => {
    let srs = srsWith({ intervalDays: 5, lapses: 7 });
    expect(isSuspended(srs)).toBe(false);
    srs = applyGrade(srs, "reviewed_forgot", NOW);
    expect(srs.lapses).toBe(8);
    expect(isSuspended(srs)).toBe(true);
  });

  it("forgetting before the threshold does not suspend", () => {
    const srs = applyGrade(srsWith({ lapses: 3 }), "reviewed_forgot", NOW);
    expect(srs.lapses).toBe(4);
    expect(isSuspended(srs)).toBe(false);
  });

  it("a suspended card stays suspended through further lapses", () => {
    const srs = applyGrade(srsWith({ lapses: 9, suspended: true }), "reviewed_forgot", NOW);
    expect(isSuspended(srs)).toBe(true);
  });

  it("newSrs is not suspended", () => {
    expect(isSuspended(newSrs(NOW))).toBe(false);
  });
});

describe("newSrs / isDue / intervalBucket", () => {
  it("newSrs seeds interval and staggers due", () => {
    const srs = newSrs(NOW, 7, 2);
    expect(srs.intervalDays).toBe(7);
    expect(daysUntilDue(srs)).toBeCloseTo(9);
  });

  it("isDue compares ISO strings correctly", () => {
    expect(isDue(srsWith({ due: NOW.toISOString() }), NOW)).toBe(true);
    expect(isDue(newSrs(NOW, 1), NOW)).toBe(false);
  });

  it("buckets cover all intervals", () => {
    expect(intervalBucket(0)).toBe(0);
    expect(intervalBucket(2)).toBe(1);
    expect(intervalBucket(400)).toBe(6);
  });

  it("scaffolding applies below the threshold, and returns after a lapse", () => {
    expect(isScaffolded(srsWith({ intervalDays: 0 }), 14)).toBe(true);
    expect(isScaffolded(srsWith({ intervalDays: 13.9 }), 14)).toBe(true);
    expect(isScaffolded(srsWith({ intervalDays: 14 }), 14)).toBe(false);
    // mature word forgotten → interval resets → scaffolding comes back
    const lapsed = applyGrade(srsWith({ intervalDays: 60 }), "reviewed_forgot", NOW);
    expect(isScaffolded(lapsed, 14)).toBe(true);
  });
});

const facetsWith = (o: Partial<Record<Direction, Partial<Facet>>>): Record<Direction, Facet> => {
  const base = newFacets();
  for (const d of ["meaning", "reading", "writing"] as Direction[]) {
    base[d] = { ...base[d], ...o[d] };
  }
  return base;
};

describe("bumpStrength", () => {
  it("moves mastery by grade: forgot -1, hard 0, remembered +1, easy +2", () => {
    expect(bumpStrength(3, "reviewed_forgot")).toBe(2);
    expect(bumpStrength(3, "reviewed_hard")).toBe(3);
    expect(bumpStrength(3, "reviewed_remembered")).toBe(4);
    expect(bumpStrength(3, "reviewed_easy")).toBe(5);
  });

  it("is bounded to [0, strengthCap]", () => {
    expect(bumpStrength(0, "reviewed_forgot")).toBe(0);
    expect(bumpStrength(TUNING.strengthCap, "reviewed_easy")).toBe(TUNING.strengthCap);
  });
});

describe("pickFacet / recordFacetAnswer", () => {
  it("asks the weakest facet first", () => {
    const facets = facetsWith({
      meaning: { strength: 4 },
      reading: { strength: 2 },
      writing: { strength: 0 },
    });
    expect(pickFacet(facets)).toBe("writing");
  });

  it("breaks ties in DIRECTIONS order (fresh card starts with meaning)", () => {
    expect(pickFacet(newFacets())).toBe("meaning");
  });

  it("restricts the pick to the allowed subset (facets set to None / unanswerable are skipped)", () => {
    const facets = facetsWith({
      meaning: { strength: 4 },
      reading: { strength: 2 },
      writing: { strength: 0 }, // weakest overall, but excluded below
    });
    // With writing disabled, the next-weakest allowed facet wins.
    expect(pickFacet(facets, ["meaning", "reading"])).toBe("reading");
    // A single allowed facet is always the pick, however strong.
    expect(pickFacet(facets, ["meaning"])).toBe("meaning");
  });

  it("weighted rotation: the weak facet is asked most, but strong ones still come up", () => {
    // meaning/reading known (strength 1), writing new — the user's own scenario.
    let facets = facetsWith({ meaning: { strength: 1 }, reading: { strength: 1 } });
    const askedSeq: Direction[] = [];
    for (let i = 0; i < 8; i++) {
      const d = pickFacet(facets);
      askedSeq.push(d);
      facets = recordFacetAnswer(facets, d, "reviewed_hard"); // hard: strength holds, isolates rotation
    }
    const counts = askedSeq.reduce(
      (acc, d) => ((acc[d] += 1), acc),
      { meaning: 0, reading: 0, writing: 0 },
    );
    expect(counts.writing).toBeGreaterThan(counts.meaning); // favored...
    expect(counts.meaning).toBeGreaterThan(0); // ...but not exclusive
    expect(counts.reading).toBeGreaterThan(0);
  });

  it("a pass on the weak facet cedes airtime back to the others", () => {
    let facets = facetsWith({ meaning: { strength: 2 }, reading: { strength: 2 } });
    // Two easy passes on writing bring its strength to 4 — now the strongest.
    facets = recordFacetAnswer(facets, "writing", "reviewed_easy");
    facets = recordFacetAnswer(facets, "writing", "reviewed_easy");
    expect(pickFacet(facets)).not.toBe("writing");
  });

  it("re-bases asked counters so they stay bounded", () => {
    let facets = newFacets();
    for (let i = 0; i < 30; i++) {
      facets = recordFacetAnswer(facets, pickFacet(facets), "reviewed_hard");
    }
    const min = Math.min(facets.meaning.asked, facets.reading.asked, facets.writing.asked);
    expect(min).toBe(0); // always re-based to zero
    expect(Math.max(facets.meaning.asked, facets.reading.asked, facets.writing.asked)).toBeLessThan(5);
  });

  it("forgot lowers strength so the failed facet returns as the pick", () => {
    let facets = facetsWith({
      meaning: { strength: 3 },
      reading: { strength: 3 },
      writing: { strength: 1 },
    });
    expect(pickFacet(facets)).toBe("writing");
    facets = recordFacetAnswer(facets, "writing", "reviewed_forgot"); // 1 → 0, asked +1
    expect(pickFacet(facets)).toBe("writing"); // still the weakest — drill it again
  });
});

describe("pinyinContains (lenient reading match)", () => {
  it("passes when the guess is a substring of the tone-marked pinyin", () => {
    expect(pinyinContains("qíguài", "guài", false)).toBe(true); // trailing syllable
    expect(pinyinContains("qíguài", "qí", false)).toBe(true); // leading syllable
    expect(pinyinContains("qíguài", "qíguài", false)).toBe(true); // whole word
  });

  it("still requires the tone marks (no toneless / tone-number shortcut)", () => {
    expect(pinyinContains("qíguài", "guai", false)).toBe(false);
    expect(pinyinContains("qíguài", "qi2guai4", false)).toBe(false);
  });

  it("accepts even a single matching character (max leniency)", () => {
    expect(pinyinContains("qíguài", "q", false)).toBe(true);
    expect(pinyinContains("qíguài", "z", false)).toBe(false); // still must appear
  });

  it("folds circumflex vowels (â î ô û) onto the 3rd-tone carons", () => {
    expect(pinyinContains("nǐ hǎo", "nî", false)).toBe(true); // nî → nǐ
    expect(pinyinContains("qǐng", "qîng", false)).toBe(true);
  });

  it("case-folds before folding tones, so an uppercase circumflex still matches", () => {
    expect(pinyinContains("nǐ hǎo", "NÎ", false)).toBe(true); // NÎ → nî → nǐ
    expect(pinyinContains("Nǐ Hǎo", "nǐhǎo", false)).toBe(true);
  });

  it("fuzzy makes 2nd and 3rd tones interchangeable inside the substring", () => {
    expect(pinyinContains("nǐ", "ní", true)).toBe(true); // 2 accepted for 3
    expect(pinyinContains("nǐ", "ní", false)).toBe(false); // exact: 2 ≠ 3
  });
});

describe("answerContains (lenient writing match)", () => {
  it("passes on a substring of a multi-character word", () => {
    expect(answerContains("图书馆", "图书")).toBe(true);
    expect(answerContains("图书馆", "图书馆")).toBe(true);
  });

  it("accepts a single matching character", () => {
    expect(answerContains("图书馆", "图")).toBe(true); // 1 of 3 is enough now
    expect(answerContains("好", "好")).toBe(true); // single-char word
    expect(answerContains("图书馆", "书")).toBe(true); // middle char
  });

  it("ignores surrounding whitespace; empty never matches", () => {
    expect(answerContains("图书馆", " 图书馆 ")).toBe(true);
    expect(answerContains("图书馆", "   ")).toBe(false);
  });

  it("a wrong character fails", () => {
    expect(answerContains("图书馆", "图书店")).toBe(false);
  });
});

describe("punctuation is stripped from both sides", () => {
  it("ignores the '<>' emphasis markers cards carry", () => {
    expect(answerContains("你<好>", "你好")).toBe(true);
    expect(answerContains("你好", "你<好>")).toBe(true);
    expect(pinyinContains("nǐ <hǎo>", "nǐhǎo", false)).toBe(true);
  });

  it("ignores punctuation in meanings", () => {
    expect(answerContains("to eat, to have (a meal)", "to eat to have a meal")).toBe(true);
    expect(answerContains("it's fine", "its fine")).toBe(true);
    expect(answerContains("and/or", "and or")).toBe(true);
  });

  it("ignores pinyin syllable separators", () => {
    expect(pinyinContains("xī'ān", "xīān", false)).toBe(true);
    expect(pinyinContains("nǐ hǎo", "nǐhǎo", false)).toBe(true);
  });

  it("a punctuation-only guess never matches", () => {
    expect(answerContains("图书馆", "，。")).toBe(false);
    expect(answerContains("it's fine", "'''")).toBe(false);
  });

  it("still rejects a genuinely wrong answer", () => {
    expect(answerContains("to eat, to have (a meal)", "to drink")).toBe(false);
  });

  it("minLen counts meaningful characters only", () => {
    expect(answerContains("你<好>吗", "你好", 2)).toBe(true); // brackets don't pad the guess
    expect(answerContains("你<好>吗", "你", 2)).toBe(false);
    expect(answerContains("你<好>吗", "你好吗", Infinity)).toBe(true); // exact ignores markers
  });
});

describe("input leniency (minLen)", () => {
  it("requires at least minLen matching characters", () => {
    expect(answerContains("图书馆", "图", 2)).toBe(false); // 1 char, needs 2
    expect(answerContains("图书馆", "图书", 2)).toBe(true); // 2 chars ok
    expect(answerContains("图书馆", "图书", 3)).toBe(false); // needs 3
    expect(answerContains("图书馆", "图书馆", 3)).toBe(true);
  });

  it("caps the requirement at the answer's own length so short answers stay reachable", () => {
    expect(answerContains("好", "好", 3)).toBe(true); // 1-char word, min(3,1)=1
  });

  it("still requires the guess to actually appear", () => {
    expect(answerContains("图书馆", "图店", 2)).toBe(false); // long enough, not a substring
  });

  it("tells a too-short-but-correct guess apart from a wrong one", () => {
    expect(answerVerdict("图书馆", "图", 2)).toBe("partial"); // right chars, not enough of them
    expect(answerVerdict("图书馆", "图店", 2)).toBe("miss"); // not in the answer at all
    expect(answerVerdict("图书馆", "图书", 2)).toBe("match");
    expect(pinyinVerdict("qíguài", "qí", false, 4)).toBe("partial");
    expect(pinyinVerdict("qíguài", "qí", false, Infinity)).toBe("partial"); // exact mode too
    expect(pinyinVerdict("qíguài", "zh", false, 4)).toBe("miss");
  });

  it("never reports partial at the most lenient setting", () => {
    expect(answerVerdict("图书馆", "图", 1)).toBe("match");
    expect(answerVerdict("好", "好", 3)).toBe("match"); // capped at the answer's length
    expect(answerVerdict("图书馆", "", 2)).toBe("miss"); // empty is a miss, not a partial
  });

  it("exact (Infinity) demands the whole answer", () => {
    expect(answerContains("图书馆", "图书", Infinity)).toBe(false);
    expect(answerContains("图书馆", "图书馆", Infinity)).toBe(true);
    expect(pinyinContains("qíguài", "qí", false, Infinity)).toBe(false);
    expect(pinyinContains("qíguài", "qíguài", false, Infinity)).toBe(true);
  });

  it("minLen defaults to 1 (unchanged lenient behaviour)", () => {
    expect(answerContains("图书馆", "图")).toBe(true);
    expect(pinyinContains("qíguài", "qí", false)).toBe(true);
  });
});
