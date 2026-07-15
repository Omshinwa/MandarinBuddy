import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { REVIEW_BATCH } from "../../../shared/src/srs";
import { DIRECTIONS, type Direction } from "../../../shared/src/types";

// A boolean setting persisted in AsyncStorage.
function useBoolSetting(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    AsyncStorage.getItem(key).then((v) => {
      if (v !== null) setValue(v === "1");
    });
  }, [key]);
  const update = useCallback(
    (v: boolean) => {
      setValue(v);
      AsyncStorage.setItem(key, v ? "1" : "0");
    },
    [key],
  );
  return [value, update];
}

// A free-text string setting persisted in AsyncStorage.
function useStringSetting(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    AsyncStorage.getItem(key).then((v) => {
      if (v !== null) setValue(v);
    });
  }, [key]);
  const update = useCallback(
    (v: string) => {
      setValue(v);
      AsyncStorage.setItem(key, v);
    },
    [key],
  );
  return [value, update];
}

// A numeric setting persisted in AsyncStorage.
function useNumberSetting(key: string, defaultValue: number): [number, (v: number) => void] {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    AsyncStorage.getItem(key).then((v) => {
      const n = v === null ? NaN : Number(v);
      if (Number.isFinite(n)) setValue(n);
    });
  }, [key]);
  const update = useCallback(
    (v: number) => {
      setValue(v);
      AsyncStorage.setItem(key, String(v));
    },
    [key],
  );
  return [value, update];
}

// Fuzzy pinyin (default on): reading answers still need tones, but the 2nd and
// 3rd tone are accepted interchangeably. Off = exact tones required.
export const DEFAULT_FUZZY_PINYIN = true;
export function useFuzzyPinyin(): [boolean, (v: boolean) => void] {
  return useBoolSetting("settings.fuzzyPinyin", DEFAULT_FUZZY_PINYIN);
}

// Input leniency: the minimum number of matching characters a typed answer needs
// (still a substring of the answer), or "exact" for the whole answer. Default 1
// = the original "any matching part counts" behaviour.
export type InputLeniency = 1 | 2 | 3 | 4 | 5 | 6 | "exact";
export const INPUT_LENIENCY_OPTIONS: InputLeniency[] = [1, 2, 3, 4, 5, 6, "exact"];
export const DEFAULT_INPUT_LENIENCY: InputLeniency = 1;

function parseLeniency(raw: string): InputLeniency {
  if (raw === "exact") return "exact";
  const n = Number(raw);
  return n === 2 || n === 3 || n === 4 || n === 5 ? (n as InputLeniency) : 1;
}

export function useInputLeniency(): [InputLeniency, (v: InputLeniency) => void] {
  const [raw, setRaw] = useStringSetting("settings.inputLeniency", String(DEFAULT_INPUT_LENIENCY));
  return [parseLeniency(raw), (v) => setRaw(String(v))];
}

// Convert a leniency setting to the `minLen` the pinyin/answer matchers expect
// ("exact" → the whole answer, via Infinity capped to the answer's length).
export function leniencyMinLen(l: InputLeniency): number {
  return l === "exact" ? Infinity : l;
}

// Auto-read (default on) doubles as the app-wide TTS mute switch: when off,
// completed AI chat replies aren't spoken AND the review screen's automatic
// audio stays silent. Toggled from the chat input bar's speaker button (the
// only place it lives now).
export const DEFAULT_AUTO_SPEAK = true;

// Module mirror of the setting so non-React TTS code (`speak()` in SpeakButton)
// can honor it without a hook. Seeded from storage on first import and kept in
// sync by useAutoSpeak.
let autoSpeakOn = DEFAULT_AUTO_SPEAK;
AsyncStorage.getItem("settings.autoSpeak").then((v) => {
  if (v !== null) autoSpeakOn = v === "1";
});
export function isAutoSpeakOn(): boolean {
  return autoSpeakOn;
}

export function useAutoSpeak(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useBoolSetting("settings.autoSpeak", DEFAULT_AUTO_SPEAK);
  useEffect(() => {
    autoSpeakOn = value;
  }, [value]);
  return [value, setValue];
}

// App theme: follow the OS ("system") or force light/dark. Unlike the per-screen
// setting hooks, this is a shared external store — every useTheme() in the tree
// subscribes, so flipping it in Settings restyles the whole app at once instead
// of only the screen that changed it. Persisted on-device like everything else.
export type ThemePref = "system" | "light" | "dark";
export const THEME_OPTIONS: ThemePref[] = ["system", "light", "dark"];
export const DEFAULT_THEME_PREF: ThemePref = "system";

function parseThemePref(raw: string): ThemePref {
  return raw === "light" || raw === "dark" ? raw : "system";
}

let themePref: ThemePref = DEFAULT_THEME_PREF;
const themeListeners = new Set<() => void>();
const emitTheme = () => themeListeners.forEach((l) => l());
AsyncStorage.getItem("settings.theme").then((v) => {
  const next = parseThemePref(v ?? "");
  if (next !== themePref) {
    themePref = next;
    emitTheme();
  }
});

export function useThemePref(): [ThemePref, (v: ThemePref) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    () => themePref,
    () => themePref,
  );
  const set = useCallback((v: ThemePref) => {
    themePref = v;
    AsyncStorage.setItem("settings.theme", v);
    emitTheme();
  }, []);
  return [value, set];
}

// "Scaffold day time": until a card's SRS interval reaches this many days, it's
// reviewed with training wheels (pinyin shown, audio auto-played). Purely a
// review-UI concern — the server's scheduling never reads it.
export const DEFAULT_SCAFFOLD_MAX_DAYS = 14;
export function useScaffoldMaxDays(): [number, (v: number) => void] {
  return useNumberSetting("settings.scaffoldMaxDays", DEFAULT_SCAFFOLD_MAX_DAYS);
}

// Review batch size: how many same-type cards are served back-to-back (so you're
// not switching keyboards every card) AND how many cards between celebration
// overlays — one knob, kept equal so a party lands as you finish a batch and
// switch exercise type. The server reads it (passed on the queue request) to
// group the queue; the review screen reads it to time the milestone. Falls back
// to the shared REVIEW_BATCH default.
export const REVIEW_BATCH_OPTIONS = [10, 15, 20, 25, 30, 40, 50, 100];
export const DEFAULT_REVIEW_BATCH = REVIEW_BATCH;
export function useReviewBatch(): [number, (v: number) => void] {
  return useNumberSetting("settings.reviewBatch", DEFAULT_REVIEW_BATCH);
}

// The language the user speaks — passed to the chat prompt so the AI falls back
// to it when glossing a word or explaining something outside Chinese. Default
// keeps the previously hard-coded bilingual behaviour.
export function useUserLanguage(): [string, (v: string) => void] {
  return useStringSetting("settings.userLanguage", DEFAULT_USER_LANGUAGE);
}
export const DEFAULT_USER_LANGUAGE = "English & French";
export const LANGUAGE_OPTIONS = [
  "English & French",
  "English",
  "Français",
  "Español",
  "Deutsch",
  "日本語",
];

// How each question type is tested in review:
//  - "flashcard": show the card, reveal the answer, self-grade (trust the user)
//  - "input":     the user must type the answer, graded from how many tries
// Defaults mirror the original behaviour: meaning is shown, reading & writing
// are typed.
export type TestMethod = "flashcard" | "input";
export const DEFAULT_TEST_METHODS: Record<Direction, TestMethod> = {
  meaning: "flashcard",
  reading: "input",
  writing: "input",
};

const methodKey = (d: Direction) => `settings.testMethod.${d}`;

// All three facets' test methods, loaded once. Used by the review screen (to
// pick which card to show) and the settings screen (to edit them).
export function useTestMethods(): [
  Record<Direction, TestMethod>,
  (d: Direction, m: TestMethod) => void,
] {
  const [methods, setMethods] = useState(DEFAULT_TEST_METHODS);
  useEffect(() => {
    Promise.all(DIRECTIONS.map((d) => AsyncStorage.getItem(methodKey(d)))).then((vals) => {
      setMethods((prev) => {
        const next = { ...prev };
        DIRECTIONS.forEach((d, i) => {
          if (vals[i] === "flashcard" || vals[i] === "input") next[d] = vals[i] as TestMethod;
        });
        return next;
      });
    });
  }, []);
  const update = useCallback((d: Direction, m: TestMethod) => {
    setMethods((prev) => ({ ...prev, [d]: m }));
    AsyncStorage.setItem(methodKey(d), m);
  }, []);
  return [methods, update];
}
