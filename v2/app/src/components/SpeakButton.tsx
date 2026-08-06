import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import React from "react";
import { Alert, Platform, Pressable, Text } from "react-native";
import { API_BASE } from "../lib/api";
import { isAutoSpeakOn } from "../lib/settings";
import { stripEmphasis } from "./TextStyling";

// Same voice as the old site: Google Translate's Mandarin TTS (the pleasant
// female voice), proxied through our server because browsers block direct
// cross-site loads from Google's endpoint. The system voice is only a fallback —
// for text too long for Google's endpoint, or if playback fails.
const GOOGLE_TTS_LIMIT = 200;

function googleTtsUrl(text: string): string {
  return `${API_BASE}/api/tts?text=${encodeURIComponent(text)}`;
}

// Let audio play even when the iPhone's silent switch is on.
if (Platform.OS !== "web") {
  setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
}

let nativePlayer: AudioPlayer | null = null;
let webAudio: HTMLAudioElement | null = null;
let warnedOnce = false;

function warn(reason: string) {
  console.warn(`[tts] google voice failed: ${reason}`);
  if (!warnedOnce) {
    warnedOnce = true;
    Alert.alert("Google voice failed", `${reason}\n\nUsing the system voice instead.`);
  }
}

function systemSpeak(text: string) {
  Speech.stop();
  Speech.speak(text, { language: "zh-CN", volume: 1.0 });
}

// Emoji pictographs, regional-indicator flags, skin-tone modifiers, the
// variation selector (U+FE0F), and the ZW joiner (U+200D) — TTS reads these
// aloud ("smiling face with…"), so drop them before speaking.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu;

// `force` bypasses the mute switch — for a dedicated play button the user tapped
// on purpose. Automatic playback (chat auto-read, review scaffold/answer audio)
// calls without it, so muting silences all of it in one place.
export function speak(text: string, opts?: { force?: boolean }) {
  if (!opts?.force && !isAutoSpeakOn()) return;
  // Cards mark emphasis with <> or * — drop the markers so TTS doesn't read them
  // aloud (matches the old site's behavior).
  const clean = stripEmphasis(text)
    .replace(/[<>*]/g, "") // unclosed markers stripEmphasis left in place
    .replace(EMOJI_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return;
  if (clean.length > GOOGLE_TTS_LIMIT) {
    // Too long for Google's endpoint (chat messages) — system voice by design.
    systemSpeak(clean);
    return;
  }
  console.log("[tts] playing google voice");

  if (Platform.OS === "web") {
    webAudio?.pause();
    webAudio = new window.Audio(googleTtsUrl(clean));
    webAudio.volume = 1.0;
    webAudio.play().catch((err) => {
      // Browsers block auto-played audio until the first tap on the page —
      // expected for the first scaffolded card after a reload; stay quiet.
      if (err instanceof Error && err.name === "NotAllowedError") {
        console.log("[tts] autoplay blocked until first interaction");
        return;
      }
      warn(String(err));
      systemSpeak(clean);
    });
    return;
  }

  try {
    nativePlayer?.release();
    const player = createAudioPlayer({ uri: googleTtsUrl(clean) });
    nativePlayer = player;
    player.volume = 1.0;
    player.play();

    // If nothing started within 2.5s, the download/playback failed — fall back.
    let started = false;
    player.addListener("playbackStatusUpdate", (status) => {
      if (status.playing || status.didJustFinish) started = true;
    });
    setTimeout(() => {
      if (nativePlayer === player && !started) {
        warn("no playback after 2.5s");
        systemSpeak(clean);
      }
    }, 2500);
  } catch (err) {
    warn(String(err));
    systemSpeak(clean);
  }
}

export function SpeakButton({ text, size = 22 }: { text: string; size?: number }) {
  // 📢 (not 🔊) marks the new audio code — if you still see 🔊 the old bundle is running.
  return (
    <Pressable hitSlop={10} onPress={() => speak(text, { force: true })} accessibilityLabel="Play audio">
      <Text style={{ fontSize: size }}>📢</Text>
    </Pressable>
  );
}
