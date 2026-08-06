import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

// Cards mark the part of a word worth noticing — 话<题> (the old site's syntax)
// or 话*题* — and the marked run renders bold with the markers themselves gone.
// Nothing else has to know about them: they're not letters, so answer matching
// already drops them (see NOISE_RE in shared/pinyin.ts), and speak() strips them
// before the text reaches TTS.
const EMPHASIS_RE = /<([^<>]+)>|\*([^*]+)\*/g;

export function stripEmphasis(text: string): string {
  return text.replace(EMPHASIS_RE, (_full, angle: string, star: string) => angle ?? star);
}

// The text as alternating plain/emphasised runs. An unclosed marker matches
// nothing and stays in the text as the literal character the user typed.
function splitEmphasis(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(EMPHASIS_RE)) {
    if (m.index > at) runs.push({ text: text.slice(at, m.index), bold: false });
    runs.push({ text: m[1] ?? m[2], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), bold: false });
  return runs;
}

// Drop-in <Text> for any card field the user authored (hanzi, pinyin, meaning,
// notes). Plain text takes the fast path, so this is safe to use everywhere.
export function TextStyling({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  if (!EMPHASIS_RE.test(text)) {
    // test() with a /g regex leaves lastIndex behind it — reset before the next call.
    EMPHASIS_RE.lastIndex = 0;
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }
  EMPHASIS_RE.lastIndex = 0;
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {splitEmphasis(text).map((run, i) =>
        run.bold ? (
          <Text key={i} style={styles.emphasis}>
            {run.text}
          </Text>
        ) : (
          run.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Heavier than "bold": at flashcard sizes a hanzi in 700 barely reads as
  // different from the characters beside it.
  emphasis: { fontWeight: "800" },
});
