import React, { useMemo, useState } from "react";
import { Text, type TextStyle } from "react-native";
import type { Word } from "../../../shared/src/types";
import { useTheme } from "../theme";

interface Segment {
  text: string;
  word?: Word;
}

interface Emphasis {
  text: string;
  bold: boolean;
  italic: boolean;
}

// Split text on a markdown delimiter (group 1 = the inner text) into marked and
// unmarked runs. An unclosed marker (mid-stream) simply doesn't match and is
// left literal until its closer streams in.
function splitMarks(text: string, re: RegExp): { text: string; marked: boolean }[] {
  const runs: { text: string; marked: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), marked: false });
    runs.push({ text: m[1], marked: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last), marked: false });
  return runs;
}

// The model writes example lists with `- ` bullets; we don't do block markdown,
// so turn line-leading `- `/`* ` into a real bullet glyph rather than let it
// render as a literal dash. (`* ` requires the trailing space, so *italic* on
// its own line is untouched.)
function bulletize(text: string): string {
  return text.replace(/^([ \t]*)[-*][ \t]+/gm, "$1• ");
}

// Parse **bold** and *italic*. Bold is stripped first, then italic inside each
// run, so a lone `*` in a **…** span can't break it. The italic delimiter
// requires a non-space just inside each `*` (and no `*` between), so a bare
// "2 * 3 * 4" stays literal.
function parseInline(text: string): Emphasis[] {
  const out: Emphasis[] = [];
  for (const b of splitMarks(text, /\*\*(.+?)\*\*/g)) {
    for (const i of splitMarks(b.text, /\*(\S(?:[^*]*?\S)?)\*/g)) {
      out.push({ text: i.text, bold: b.marked, italic: i.marked });
    }
  }
  return out;
}

// Split text into plain runs and dictionary-word runs (longest match wins).
function segmentText(text: string, byFirstChar: Map<string, Word[]>): Segment[] {
  const segments: Segment[] = [];
  let plain = "";
  let i = 0;
  while (i < text.length) {
    const candidates = byFirstChar.get(text[i]);
    const match = candidates?.find((w) => text.startsWith(w.chinese, i));
    if (match) {
      if (plain) {
        segments.push({ text: plain });
        plain = "";
      }
      segments.push({ text: match.chinese, word: match });
      i += match.chinese.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

interface Props {
  text: string;
  words: Word[];
  onReveal: (word: Word) => void;
  fontSize?: number;
  onLongPress?: () => void;
}

/**
 * Renders AI text with dictionary words highlighted. Tapping a word reveals its
 * gloss inline and notifies the parent (which applies the conversation_missed grade).
 */
export function GlossedText({ text, words, onReveal, fontSize = 20, onLongPress }: Props) {
  const t = useTheme();
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const byFirstChar = useMemo(() => {
    const map = new Map<string, Word[]>();
    for (const w of words) {
      if (!w.chinese) continue;
      const list = map.get(w.chinese[0]) ?? [];
      list.push(w);
      map.set(w.chinese[0], list);
    }
    for (const list of map.values()) list.sort((a, b) => b.chinese.length - a.chinese.length);
    return map;
  }, [words]);

  // Emphasis runs first, then dictionary-word segmentation inside each so
  // **bold**/*italic* and word glossing compose (an emphasized glossed word
  // stays tappable).
  const runs = useMemo(
    () =>
      parseInline(bulletize(text)).map((r) => ({
        bold: r.bold,
        italic: r.italic,
        segments: segmentText(r.text, byFirstChar),
      })),
    [text, byFirstChar],
  );

  return (
    // Long-press opens the message actions (copy / speak); a tap on a highlighted
    // word still reveals its gloss (tap and long-press are different gestures).
    <Text onLongPress={onLongPress} style={{ fontSize, lineHeight: fontSize * 1.5, color: t.text }}>
      {runs.map((run, ri) =>
        run.segments.map((seg, si) => {
          const key = `${ri}-${si}`;
          const emphasis: TextStyle = {};
          if (run.bold) emphasis.fontWeight = "bold";
          if (run.italic) emphasis.fontStyle = "italic";
          if (!seg.word) return <Text key={key} style={emphasis}>{seg.text}</Text>;
          const word = seg.word;
          const isRevealed = revealed.has(word._id);
          return (
            <Text key={key} style={emphasis}>
              <Text
                style={{
                  backgroundColor: t.highlight,
                  textDecorationLine: "underline",
                  textDecorationStyle: "dotted",
                }}
                onPress={() => {
                  if (!isRevealed) {
                    setRevealed((prev) => new Set(prev).add(word._id));
                    onReveal(word);
                  }
                }}
              >
                {seg.text}
              </Text>
              {isRevealed && (
                <Text
                  style={{
                    color: t.subtext,
                    fontSize: fontSize * 0.75,
                    fontWeight: "normal",
                    fontStyle: "normal",
                  }}
                >
                  {` (${word.pinyin} — ${word.def_english})`}
                </Text>
              )}
            </Text>
          );
        }),
      )}
    </Text>
  );
}
