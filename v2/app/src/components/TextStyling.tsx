import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { splitEmphasis } from "../../../shared/src";

// Drop-in <Text> for any card field the user authored (hanzi, pinyin, meaning,
// notes): the emphasis markers (see shared/text.ts) render as bold and the
// markers themselves disappear. Plain text passes straight through, so this is
// safe to use everywhere.
export function TextStyling({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
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
