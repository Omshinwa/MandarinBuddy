import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import type { Theme } from "../theme";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// The whole overlay is the "next" button — tap anywhere to continue.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Vivid, theme-independent confetti palette — this is a party either way.
const CONFETTI = [
  "#ff595e", "#ff924c", "#ffca3a", "#8ac926", "#36949d",
  "#1982c4", "#4267ac", "#6a4c93", "#ff5da2", "#00c2a8",
];

// This just
// picks how big the party is from the running card count
type Tier = "small" | "big" | "huge";
function tierOf(count: number): Tier {
  if (count > 50) return "huge";
  if (count > 20) return "big";
  return "small";
}

const TIER: Record<Tier, { confetti: number; cycleMs: number; emoji: string; title: string; fall: number; spins: number }> = {
  small: { confetti: 16, cycleMs: 6000, emoji: "🎉", title: "nice!", fall: 2200, spins: 2 },
  big: { confetti: 32, cycleMs: 2400, emoji: "🎊🥳🔥", title: "on fire!", fall: 1500, spins: 4 },
  huge: { confetti: 58, cycleMs: 1000, emoji: "🏆🎆🌈🚀", title: "legendary!!", fall: 850, spins: 7 },
};

function ConfettiPiece({ i, tier }: { i: number; tier: Tier }) {
  const cfg = TIER[tier];
  const p = useRef(new Animated.Value(0)).current;
  const startX = useMemo(() => Math.random() * SCREEN_W, []);
  const size = useMemo(() => 8 + Math.random() * (tier === "huge" ? 16 : 8), [tier]);
  const dur = useMemo(() => cfg.fall + Math.random() * 1200, [cfg.fall]);
  const delay = useMemo(() => Math.random() * cfg.cycleMs, [cfg.cycleMs]);
  const round = useMemo(() => Math.random() < 0.5, []);
  const color = CONFETTI[i % CONFETTI.length];

  useEffect(() => {
    Animated.loop(
      Animated.timing(p, { toValue: 1, duration: dur, delay, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, [p, dur, delay]);

  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [-40, SCREEN_H + 40] });
  const translateX = p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, i % 2 ? 34 : -34, 0] });
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${cfg.spins * 360}deg`] });
  const opacity = p.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: startX,
        top: 0,
        width: size,
        height: size * 0.62,
        backgroundColor: color,
        borderRadius: round ? size : 2,
        transform: [{ translateY }, { translateX }, { rotate }],
        opacity,
      }}
    />
  );
}

// Full-screen celebration shown in place of the next card at each milestone.
export function MilestoneOverlay({ count, onContinue, t }: { count: number; onContinue: () => void; t: Theme }) {
  const tier = tierOf(count);
  const cfg = TIER[tier];
  const hue = useRef(new Animated.Value(0)).current; // party background cycle (color → no native driver)
  const pop = useRef(new Animated.Value(0)).current; // entrance
  const pulse = useRef(new Animated.Value(0)).current; // heartbeat on the emoji

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (tier === "huge") {
      [180, 360].forEach((ms) =>
        setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), ms),
      );
    }
    Animated.loop(
      Animated.timing(hue, { toValue: 1, duration: cfg.cycleMs, easing: Easing.linear, useNativeDriver: false }),
    ).start();
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: tier === "huge" ? 300 : 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: tier === "huge" ? 300 : 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  // "small" stays in a calmer purple band; "big"/"huge" cycle the full rainbow.
  const bg = hue.interpolate({
    inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
    outputRange:
      tier === "small"
        ? ["#3a1c71", "#5c3a92", "#7a4bb0", "#5c3a92", "#3a1c71", "#3a1c71"]
        : ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff595e"],
  });

  const scale = Animated.multiply(
    pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, tier === "huge" ? 1.2 : 1.08] }),
  );
  const wobble = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: tier === "huge" ? ["-7deg", "7deg"] : ["-2deg", "2deg"],
  });

  return (
    <AnimatedPressable
      style={[styles.fill, { backgroundColor: bg }]}
      onPress={onContinue}
      accessibilityRole="button"
      accessibilityLabel="Keep reviewing — tap anywhere to continue"
    >
      {Array.from({ length: cfg.confetti }).map((_, i) => (
        <ConfettiPiece key={i} i={i} tier={tier} />
      ))}
      <Animated.Text style={[styles.emoji, tier === "huge" && styles.emoji100, { transform: [{ scale }, { rotate: wobble }] }]}>
        {cfg.emoji}
      </Animated.Text>
      <Animated.View style={{ transform: [{ scale: pop }], alignItems: "center" }}>
        <Text style={[styles.congrats, tier === "huge" && { fontSize: 42 }]}>Congrats!</Text>
        <Text style={styles.count}>You've reviewed {count} cards!</Text>
        <Text style={styles.tierTitle}>{cfg.title}</Text>
      </Animated.View>
      {/* Decorative affordance only — the whole overlay above is the tap target. */}
      <View style={styles.button} pointerEvents="none">
        <Text style={styles.buttonText}>Keep going →</Text>
      </View>
    </AnimatedPressable>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.35)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 };

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  emoji: { fontSize: 74, textAlign: "center" },
  emoji100: { fontSize: 100 },
  congrats: { fontSize: 34, fontWeight: "900", color: "#fff", letterSpacing: 1, ...shadow },
  count: { fontSize: 18, fontWeight: "700", color: "#fff", marginTop: 6, textAlign: "center", paddingHorizontal: 30, ...shadow },
  tierTitle: { fontSize: 15, fontWeight: "800", color: "#ffffffdd", marginTop: 8, letterSpacing: 4, textTransform: "uppercase" },
  button: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderColor: "#fff",
    borderWidth: 2,
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 34,
  },
  buttonText: { color: "#fff", fontWeight: "800", fontSize: 17 },
});
