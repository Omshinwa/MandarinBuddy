import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { applyGrade, type Grade, type Srs } from "../../../../shared/src";
import type { Theme } from "../../theme";

// Reading & writing are typed tests, so the app grades them from how many tries
// the answer took instead of asking: 1 try = Easy, 2–3 = Okay, 4+ = Hard.
export function gradeForTries(tries: number): Grade {
  if (tries === 1) return "reviewed_easy";
  if (tries <= 3) return "reviewed_okay";
  return "reviewed_hard";
}

export function gradeLabel(g: Grade): string {
  return g === "reviewed_easy"
    ? "Easy"
    : g === "reviewed_okay"
      ? "Okay"
      : g === "reviewed_hard"
        ? "Hard"
        : "Forgot";
}

export function gradeColor(t: Theme, g: Grade): string {
  return g === "reviewed_forgot"
    ? t.danger
    : g === "reviewed_hard"
      ? t.warning
      : g === "reviewed_okay"
        ? t.success
        : t.tint;
}

// "🐢 leech" if this grade suspends the card, "now" for re-shown-this-session,
// otherwise the projected next interval.
export function previewLabel(srs: Srs, grade: Grade): string {
  const next = applyGrade(srs, grade, new Date());
  if (next.suspended && !srs.suspended) return "🐢 leech";
  if (next.due <= new Date().toISOString()) return "now";
  return next.intervalDays < 1 ? "<1d" : `${Math.round(next.intervalDays)}d`;
}

const GRADE_BUTTONS: { grade: Grade; label: string }[] = [
  { grade: "reviewed_forgot", label: "Forgot" },
  { grade: "reviewed_hard", label: "Hard" },
  { grade: "reviewed_okay", label: "Okay" },
  { grade: "reviewed_easy", label: "Easy" },
];

// The flashcard's four self-grade buttons, each showing what it costs you.
export function GradeButtons({
  srs,
  onGrade,
  t,
}: {
  srs: Srs;
  onGrade: (g: Grade) => void;
  t: Theme;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignSelf: "stretch" }}>
      {GRADE_BUTTONS.map(({ grade, label }) => (
        <Pressable
          key={grade}
          style={[styles.gradeButton, { backgroundColor: gradeColor(t, grade) }]}
          onPress={() => onGrade(grade)}
        >
          <Text style={styles.gradeLabel} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.gradePreview} numberOfLines={1}>
            {previewLabel(srs, grade)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  gradeButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 2,
    alignItems: "center",
  },
  gradeLabel: { color: "#fff", fontWeight: "700", fontSize: 14 },
  gradePreview: { color: "#ffffffcc", fontSize: 11, marginTop: 1 },
});
