import { describe, expect, it } from "vitest";
import {
  applyGrade,
  type Facet,
  type FacetState,
  isDue,
  isLeechMilestone,
  isScaffolded,
  lenientVerdict,
  newSrs,
  normalizeText,
  type Srs,
  TUNING,
} from "../../shared/src";
import { pickFacet, recordFacetAnswer } from "../src/facets";

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
    const next = applyGrade(srsWith({ intervalDays: 0 }), "reviewed_okay", NOW);
    expect(next.intervalDays).toBe(1);
    expect(daysUntilDue(next)).toBeCloseTo(1);
  });

  it("remembered: interval grows by ease", () => {
    const next = applyGrade(srsWith({ intervalDays: 4 }), "reviewed_okay", NOW);
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
    expect(srs.suspended).toBeFalsy();
    srs = applyGrade(srs, "reviewed_forgot", NOW);
    expect(srs.lapses).toBe(8);
    expect(srs.suspended).toBe(true);
  });

  it("forgetting before the threshold does not suspend", () => {
    const srs = applyGrade(srsWith({ lapses: 3 }), "reviewed_forgot", NOW);
    expect(srs.lapses).toBe(4);
    expect(srs.suspended).toBeFalsy();
  });

  it("a suspended card stays suspended through further lapses", () => {
    const srs = applyGrade(srsWith({ lapses: 9, suspended: true }), "reviewed_forgot", NOW);
    expect(srs.suspended).toBe(true);
  });

  it("newSrs is not suspended", () => {
    expect(newSrs(NOW).suspended).toBe(false);
  });
});

describe("newSrs / isDue", () => {
  it("newSrs seeds interval and staggers due", () => {
    const srs = newSrs(NOW, 7, 2);
    expect(srs.intervalDays).toBe(7);
    expect(daysUntilDue(srs)).toBeCloseTo(9);
  });

  it("isDue compares ISO strings correctly", () => {
    expect(isDue(srsWith({ due: NOW.toISOString() }), NOW)).toBe(true);
    expect(isDue(newSrs(NOW, 1), NOW)).toBe(false);
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

const newFacets = (): Record<Facet, FacetState> => ({
  meaning: { strength: 0, asked: 0 },
  reading: { strength: 0, asked: 0 },
  writing: { strength: 0, asked: 0 },
});

const facetsWith = (o: Partial<Record<Facet, Partial<FacetState>>>): Record<Facet, FacetState> => {
  const base = newFacets();
  for (const d of ["meaning", "reading", "writing"] as Facet[]) {
    base[d] = { ...base[d], ...o[d] };
  }
  return base;
};

describe("pickFacet / recordFacetAnswer", () => {
  it("asks the weakest facet first", () => {
    const facets = facetsWith({
      meaning: { strength: 4 },
      reading: { strength: 2 },
      writing: { strength: 0 },
    });
    expect(pickFacet(facets)).toBe("writing");
  });

  it("breaks ties in FACETS order (fresh card starts with writing)", () => {
    expect(pickFacet(newFacets())).toBe("writing");
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
    const askedSeq: Facet[] = [];
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

describe("lenientVerdict — reading (typed pinyin)", () => {
  it("passes when the guess is a substring of the tone-marked pinyin", () => {
    expect(lenientVerdict("qíguài", "guài", false)).toBe("match"); // trailing syllable
    expect(lenientVerdict("qíguài", "qí", false)).toBe("match"); // leading syllable
    expect(lenientVerdict("qíguài", "qíguài", false)).toBe("match"); // whole word
  });

  it("still requires the tone marks (no toneless / tone-number shortcut)", () => {
    expect(lenientVerdict("qíguài", "guai", false)).not.toBe("match");
    expect(lenientVerdict("qíguài", "qi2guai4", false)).not.toBe("match");
  });

  it("accepts even a single matching character (max leniency)", () => {
    expect(lenientVerdict("qíguài", "q", false)).toBe("match");
    expect(lenientVerdict("qíguài", "z", false)).not.toBe("match"); // still must appear
  });

  it("folds circumflex vowels (â î ô û) onto the 3rd-tone carons", () => {
    expect(lenientVerdict("nǐ hǎo", "nî", false)).toBe("match"); // nî → nǐ
    expect(lenientVerdict("qǐng", "qîng", false)).toBe("match");
  });

  it("case-folds before folding tones, so an uppercase circumflex still matches", () => {
    expect(lenientVerdict("nǐ hǎo", "NÎ", false)).toBe("match"); // NÎ → nî → nǐ
    expect(lenientVerdict("Nǐ Hǎo", "nǐhǎo", false)).toBe("match");
  });

  it("fuzzy makes 2nd and 3rd tones interchangeable inside the substring", () => {
    expect(lenientVerdict("nǐ", "ní", true)).toBe("match"); // 2 accepted for 3
    expect(lenientVerdict("nǐ", "ní", false)).not.toBe("match"); // exact: 2 ≠ 3
  });
});

describe("lenientVerdict — writing (typed hanzi / English)", () => {
  it("passes on a substring of a multi-character word", () => {
    expect(lenientVerdict("图书馆", "图书")).toBe("match");
    expect(lenientVerdict("图书馆", "图书馆")).toBe("match");
  });

  it("accepts a single matching character", () => {
    expect(lenientVerdict("图书馆", "图")).toBe("match"); // 1 of 3 is enough now
    expect(lenientVerdict("好", "好")).toBe("match"); // single-char word
    expect(lenientVerdict("图书馆", "书")).toBe("match"); // middle char
  });

  it("ignores surrounding whitespace; empty never matches", () => {
    expect(lenientVerdict("图书馆", " 图书馆 ")).toBe("match");
    expect(lenientVerdict("图书馆", "   ")).not.toBe("match");
  });

  it("a wrong character fails", () => {
    expect(lenientVerdict("图书馆", "图书店")).not.toBe("match");
  });
});

describe("normalizeText (shared by answer matching and the word search)", () => {
  it("drops case, spaces, punctuation and the emphasis markers", () => {
    expect(normalizeText("图<书>馆")).toBe("图书馆");
    expect(normalizeText("话*题*")).toBe("话题");
    expect(normalizeText("To Eat, to have (a meal)")).toBe("toeattohaveameal");
  });

  it("keeps tone marks by default — in an answer the tone is part of the answer", () => {
    expect(normalizeText("nǐ hǎo")).toBe("nǐhǎo");
  });

  it("toneless drops them, so the search finds 'ài' by typing 'ai'", () => {
    expect(normalizeText("nǐ hǎo", false, true)).toBe("nihao");
    expect(normalizeText("ài", false, true)).toBe("ai");
  });

  it("reads a circumflex as a 3rd tone either way", () => {
    expect(normalizeText("nî")).toBe("nǐ");
    expect(normalizeText("nî", false, true)).toBe("ni");
  });
});

describe("punctuation is stripped from both sides", () => {
  it("ignores the '<>' emphasis markers cards carry", () => {
    expect(lenientVerdict("你<好>", "你好")).toBe("match");
    expect(lenientVerdict("你好", "你<好>")).toBe("match");
    expect(lenientVerdict("nǐ <hǎo>", "nǐhǎo", false)).toBe("match");
  });

  it("ignores punctuation in meanings", () => {
    expect(lenientVerdict("to eat, to have (a meal)", "to eat to have a meal")).toBe("match");
    expect(lenientVerdict("it's fine", "its fine")).toBe("match");
    expect(lenientVerdict("and/or", "and or")).toBe("match");
  });

  it("ignores pinyin syllable separators", () => {
    expect(lenientVerdict("xī'ān", "xīān", false)).toBe("match");
    expect(lenientVerdict("nǐ hǎo", "nǐhǎo", false)).toBe("match");
  });

  it("a punctuation-only guess never matches", () => {
    expect(lenientVerdict("图书馆", "，。")).not.toBe("match");
    expect(lenientVerdict("it's fine", "'''")).not.toBe("match");
  });

  it("still rejects a genuinely wrong answer", () => {
    expect(lenientVerdict("to eat, to have (a meal)", "to drink")).not.toBe("match");
  });

  it("minLen counts meaningful characters only", () => {
    expect(lenientVerdict("你<好>吗", "你好", false, 2)).toBe("match"); // brackets don't pad the guess
    expect(lenientVerdict("你<好>吗", "你", false, 2)).not.toBe("match");
    expect(lenientVerdict("你<好>吗", "你好吗", false, Infinity)).toBe("match"); // exact ignores markers
  });
});

describe("input leniency (minLen)", () => {
  it("requires at least minLen matching characters", () => {
    expect(lenientVerdict("图书馆", "图", false, 2)).not.toBe("match"); // 1 char, needs 2
    expect(lenientVerdict("图书馆", "图书", false, 2)).toBe("match"); // 2 chars ok
    expect(lenientVerdict("图书馆", "图书", false, 3)).not.toBe("match"); // needs 3
    expect(lenientVerdict("图书馆", "图书馆", false, 3)).toBe("match");
  });

  it("caps the requirement at the answer's own length so short answers stay reachable", () => {
    expect(lenientVerdict("好", "好", false, 3)).toBe("match"); // 1-char word, min(3,1)=1
  });

  it("still requires the guess to actually appear", () => {
    expect(lenientVerdict("图书馆", "图店", false, 2)).not.toBe("match"); // long enough, not a substring
  });

  it("tells a too-short-but-correct guess apart from a wrong one", () => {
    expect(lenientVerdict("图书馆", "图", false, 2)).toBe("partial"); // right chars, not enough of them
    expect(lenientVerdict("图书馆", "图店", false, 2)).toBe("miss"); // not in the answer at all
    expect(lenientVerdict("图书馆", "图书", false, 2)).toBe("match");
    expect(lenientVerdict("qíguài", "qí", false, 4)).toBe("partial");
    expect(lenientVerdict("qíguài", "qí", false, Infinity)).toBe("partial"); // exact mode too
    expect(lenientVerdict("qíguài", "zh", false, 4)).toBe("miss");
  });

  it("never reports partial at the most lenient setting", () => {
    expect(lenientVerdict("图书馆", "图", false, 1)).toBe("match");
    expect(lenientVerdict("好", "好", false, 3)).toBe("match"); // capped at the answer's length
    expect(lenientVerdict("图书馆", "", false, 2)).toBe("miss"); // empty is a miss, not a partial
  });

  it("exact (Infinity) demands the whole answer", () => {
    expect(lenientVerdict("图书馆", "图书", false, Infinity)).not.toBe("match");
    expect(lenientVerdict("图书馆", "图书馆", false, Infinity)).toBe("match");
    expect(lenientVerdict("qíguài", "qí", false, Infinity)).not.toBe("match");
    expect(lenientVerdict("qíguài", "qíguài", false, Infinity)).toBe("match");
  });

  it("minLen defaults to 1 (unchanged lenient behaviour)", () => {
    expect(lenientVerdict("图书馆", "图")).toBe("match");
    expect(lenientVerdict("qíguài", "qí", false)).toBe("match");
  });
});
