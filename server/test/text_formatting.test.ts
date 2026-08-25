import { describe, expect, it } from "vitest";
import { emphasizedPart, splitEmphasis, stripEmphasis } from "../../shared/src";

// The <>/* markers on a card are a convention three places now depend on (the
// review card's bold run, the chat gloss's word matching, the model's vocabulary
// block), so the two readings of a marked field are pinned down here.

describe("stripEmphasis (the field with its markers removed)", () => {
  it("drops both marker styles", () => {
    expect(stripEmphasis("话<题>")).toBe("话题");
    expect(stripEmphasis("话*题*")).toBe("话题");
  });

  it("leaves unmarked text alone", () => {
    expect(stripEmphasis("话题")).toBe("话题");
  });

  it("leaves an unclosed marker as the literal character typed", () => {
    expect(stripEmphasis("话<题")).toBe("话<题");
  });
});

describe("emphasizedPart (the run that IS the word)", () => {
  it("reduces a marked word to its marked run", () => {
    expect(emphasizedPart("话<题>")).toBe("题");
    expect(emphasizedPart("话*题*")).toBe("题");
    expect(emphasizedPart("<好>")).toBe("好");
  });

  it("applies to pinyin the same way, so a gloss can line up", () => {
    expect(emphasizedPart("huà<tí>")).toBe("tí");
  });

  it("keeps an unmarked word whole", () => {
    expect(emphasizedPart("话题")).toBe("话题");
    expect(emphasizedPart("huàtí")).toBe("huàtí");
  });

  it("joins multiple marked runs", () => {
    expect(emphasizedPart("<学>习<班>")).toBe("学班");
  });

  it("falls back to the stripped field when nothing is marked off", () => {
    expect(emphasizedPart("话<题")).toBe("话<题");
    expect(emphasizedPart("")).toBe("");
  });
});

describe("splitEmphasis (runs for rendering)", () => {
  it("alternates plain and bold runs", () => {
    expect(splitEmphasis("话<题>")).toEqual([
      { text: "话", bold: false },
      { text: "题", bold: true },
    ]);
  });

  it("returns unmarked text as a single plain run", () => {
    expect(splitEmphasis("话题")).toEqual([{ text: "话题", bold: false }]);
  });

  it("has no leftover regex state between calls", () => {
    expect(splitEmphasis("<好>")).toEqual([{ text: "好", bold: true }]);
    expect(splitEmphasis("<好>")).toEqual([{ text: "好", bold: true }]);
  });
});
