import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme";

// The two button shapes the app uses everywhere, so a primary action looks the
// same on every screen: a filled pill (tinted unless told otherwise) and a
// bordered one that carries its color in the outline and the label.
// Layout that belongs to the caller — flex, alignSelf, margins — comes in via
// `style`; both stretch to their container by default.

export function PrimaryButton({
  label,
  onPress,
  color,
  disabled,
  large,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string; // defaults to the theme tint
  disabled?: boolean;
  large?: boolean; // the review screen's fat commit button
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressable
      style={[
        styles.filled,
        large && styles.filledLarge,
        { backgroundColor: color ?? t.tint, opacity: disabled ? 0.4 : 1 },
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.filledLabel, large && styles.filledLargeLabel]}>{label}</Text>
    </Pressable>
  );
}

export function OutlineButton({
  label,
  onPress,
  color,
  borderColor,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string; // label color; defaults to the theme tint
  borderColor?: string; // defaults to the label color
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const tone = color ?? t.tint;
  return (
    <Pressable style={[styles.outline, { borderColor: borderColor ?? tone }, style]} onPress={onPress}>
      <Text style={[styles.outlineLabel, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filled: { alignSelf: "stretch", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  filledLarge: { borderRadius: 14, paddingVertical: 20 },
  filledLabel: { color: "#fff", fontWeight: "700", fontSize: 16 },
  filledLargeLabel: { fontWeight: "800", fontSize: 19 },
  outline: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    borderWidth: 1.5,
  },
  outlineLabel: { fontWeight: "700", fontSize: 15 },
});
