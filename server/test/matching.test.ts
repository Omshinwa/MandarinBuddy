import { describe, expect, it } from "vitest";
import { lenientVerdict, numberedToToneMarks } from "../../shared/src";

describe("numberedToToneMarks (typing pinyin with tone numbers)", () => {
  it("turns a vowel + tone number into the toned vowel", () => {
    expect(numberedToToneMarks("a1")).toBe("ā");
    expect(numberedToToneMarks("i4")).toBe("ì");
    expect(numberedToToneMarks("ha3o")).toBe("hǎo");
    expect(numberedToToneMarks("ni3 ha3o")).toBe("nǐ hǎo");
  });

  it("places a syllable-final number on the right vowel", () => {
    // 1. a or e wins
    expect(numberedToToneMarks("hao3")).toBe("hǎo");
    expect(numberedToToneMarks("xian3")).toBe("xiǎn");
    expect(numberedToToneMarks("xie4")).toBe("xiè");
    expect(numberedToToneMarks("lve4")).toBe("lüè");
    expect(numberedToToneMarks("zhuang4")).toBe("zhuàng");
    expect(numberedToToneMarks("er2")).toBe("ér");
    // 2. the o of ou
    expect(numberedToToneMarks("gou3")).toBe("gǒu");
    // 3. otherwise the last vowel
    expect(numberedToToneMarks("guo2")).toBe("guó");
    expect(numberedToToneMarks("liu2")).toBe("liú");
    expect(numberedToToneMarks("gui4")).toBe("guì");
    expect(numberedToToneMarks("xiong2")).toBe("xióng");
    // several syllables, with or without spaces
    expect(numberedToToneMarks("ni3hao3")).toBe("nǐhǎo");
    expect(numberedToToneMarks("Zhong1guo2")).toBe("Zhōngguó");
  });

  it("uses v for ü", () => {
    expect(numberedToToneMarks("nv3")).toBe("nǚ");
    expect(numberedToToneMarks("lü4")).toBe("lǜ");
  });

  it("leaves other digits and consonant + digit alone", () => {
    expect(numberedToToneMarks("a5")).toBe("a5");
    expect(numberedToToneMarks("n3")).toBe("n3");
    expect(numberedToToneMarks("lv")).toBe("lv");
  });

  it("produces text that matches the stored pinyin", () => {
    expect(lenientVerdict("nǐ hǎo", numberedToToneMarks("ni3ha3o"))).toBe("match");
  });
});
