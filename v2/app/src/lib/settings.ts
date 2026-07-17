import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { REVIEW_BATCH } from "../../../shared/src/srs";
import { DIRECTIONS, type Direction } from "../../../shared/src/types";

// Settings live in a tiny in-memory reactive store, not per-component state.
// Every hook that reads a setting subscribes to the same store, so a change made
// in one screen (e.g. the Settings modal) re-renders every other reader live —
// including a review session that's already in progress. Values are mirrored to
// AsyncStorage so they survive a reload, but the store is the source of truth
// once hydrated. (The old design read storage once per hook on mount, so edits
// never reached a screen that was already open.)

type Listener = () => void;

interface Store<T> {
  get: () => T;
  set: (v: T) => void;
  subscribe: (l: Listener) => () => void;
}

function createStore<T>(
  key: string,
  defaultValue: T,
  decode: (raw: string) => T | undefined,
  encode: (v: T) => string,
): Store<T> {
  let value = defaultValue;
  let hydrated = false;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  // The first subscriber triggers a one-time load; when it lands we adopt the
  // stored value and notify everyone already listening.
  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    AsyncStorage.getItem(key).then((raw) => {
      if (raw === null) return;
      const decoded = decode(raw);
      if (decoded !== undefined) {
        value = decoded;
        emit();
      }
    });
  };
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      AsyncStorage.setItem(key, encode(v)).catch(() => {});
      emit();
    },
    subscribe: (l) => {
      hydrate();
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// getSnapshot is passed as the server snapshot too — there's no SSR here, and a
// primitive/stable-ref value keeps useSyncExternalStore from looping.
function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

const boolStore = (key: string, def: boolean) =>
  createStore<boolean>(
    key,
    def,
    (r) => (r === "1" ? true : r === "0" ? false : undefined),
    (v) => (v ? "1" : "0"),
  );

const numberStore = (key: string, def: number) =>
  createStore<number>(
    key,
    def,
    (r) => (Number.isFinite(Number(r)) ? Number(r) : undefined),
    String,
  );

const stringStore = (key: string, def: string) =>
  createStore<string>(key, def, (r) => r, (v) => v);

// Fuzzy pinyin (default on): reading answers still need tones, but the 2nd and
// 3rd tone are accepted interchangeably. Off = exact tones required.
export const DEFAULT_FUZZY_PINYIN = true;
const fuzzyPinyinStore = boolStore("settings.fuzzyPinyin", DEFAULT_FUZZY_PINYIN);
export function useFuzzyPinyin(): [boolean, (v: boolean) => void] {
  return [useStore(fuzzyPinyinStore), fuzzyPinyinStore.set];
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
  return n === 2 || n === 3 || n === 4 || n === 5 || n === 6 ? (n as InputLeniency) : 1;
}

const leniencyStore = stringStore("settings.inputLeniency", String(DEFAULT_INPUT_LENIENCY));
export function useInputLeniency(): [InputLeniency, (v: InputLeniency) => void] {
  return [parseLeniency(useStore(leniencyStore)), (v) => leniencyStore.set(String(v))];
}

// Convert a leniency setting to the `minLen` the pinyin/answer matchers expect
// ("exact" → the whole answer, via Infinity capped to the answer's length).
export function leniencyMinLen(l: InputLeniency): number {
  return l === "exact" ? Infinity : l;
}

// Auto-read (default on) doubles as the app-wide TTS mute switch: when off,
// completed AI chat replies aren't spoken AND the review screen's automatic
// audio stays silent. Toggled from the chat input bar's speaker button.
export const DEFAULT_AUTO_SPEAK = true;
const autoSpeakStore = boolStore("settings.autoSpeak", DEFAULT_AUTO_SPEAK);
// speak() in SpeakButton is non-React and needs the value synchronously, even
// before any component subscribes — so kick a one-time hydration now.
autoSpeakStore.subscribe(() => {});
export function isAutoSpeakOn(): boolean {
  return autoSpeakStore.get();
}
export function useAutoSpeak(): [boolean, (v: boolean) => void] {
  return [useStore(autoSpeakStore), autoSpeakStore.set];
}

// App theme: follow the OS ("system") or force light/dark. Every useTheme() in
// the tree reads this store, so flipping it in Settings restyles the whole app
// at once rather than only the screen that changed it.
export type ThemePref = "system" | "light" | "dark";
export const THEME_OPTIONS: ThemePref[] = ["system", "light", "dark"];
export const DEFAULT_THEME_PREF: ThemePref = "system";

function parseThemePref(raw: string): ThemePref {
  return raw === "light" || raw === "dark" ? raw : "system";
}

const themeStore = stringStore("settings.theme", DEFAULT_THEME_PREF);
export function useThemePref(): [ThemePref, (v: ThemePref) => void] {
  return [parseThemePref(useStore(themeStore)), themeStore.set];
}

// "Scaffold day time": until a card's SRS interval reaches this many days, it's
// reviewed with training wheels (pinyin shown, audio auto-played). Purely a
// review-UI concern — the server's scheduling never reads it.
export const DEFAULT_SCAFFOLD_MAX_DAYS = 14;
const scaffoldMaxDaysStore = numberStore("settings.scaffoldMaxDays", DEFAULT_SCAFFOLD_MAX_DAYS);
export function useScaffoldMaxDays(): [number, (v: number) => void] {
  return [useStore(scaffoldMaxDaysStore), scaffoldMaxDaysStore.set];
}

// "Both" transition day: a facet set to Both is a flashcard while the card is
// young and becomes a typed Input test once its interval reaches this many days.
// Same UI-only nature as the scaffold cutoff; the server never reads it.
export const DEFAULT_BOTH_TRANSITION_DAYS = 14;
const bothTransitionDaysStore = numberStore(
  "settings.bothTransitionDays",
  DEFAULT_BOTH_TRANSITION_DAYS,
);
export function useBothTransitionDays(): [number, (v: number) => void] {
  return [useStore(bothTransitionDaysStore), bothTransitionDaysStore.set];
}

// Review batch size: how many same-type cards are served back-to-back (so you're
// not switching keyboards every card) AND how many cards between celebration
// overlays — one knob, kept equal so a party lands as you finish a batch and
// switch exercise type. The server reads it (passed on the queue request) to
// group the queue; the review screen reads it to time the milestone. Falls back
// to the shared REVIEW_BATCH default.
export const REVIEW_BATCH_OPTIONS = [10, 15, 20, 25, 30, 40, 50, 100];
export const DEFAULT_REVIEW_BATCH = REVIEW_BATCH;
const reviewBatchStore = numberStore("settings.reviewBatch", DEFAULT_REVIEW_BATCH);
export function useReviewBatch(): [number, (v: number) => void] {
  return [useStore(reviewBatchStore), reviewBatchStore.set];
}

// The language the user speaks — passed to the chat prompt so the AI falls back
// to it when glossing a word or explaining something outside Chinese. Default
// keeps the previously hard-coded bilingual behaviour.
export const DEFAULT_USER_LANGUAGE = "English & French";
const userLanguageStore = stringStore("settings.userLanguage", DEFAULT_USER_LANGUAGE);
export function useUserLanguage(): [string, (v: string) => void] {
  return [useStore(userLanguageStore), userLanguageStore.set];
}
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
//  - "both":      flashcard while the card is young, input once it matures — the
//                 switch happens at the "Both transition day" interval
// Defaults mirror the original behaviour: meaning is shown, reading & writing
// are typed.
export type TestMethod = "flashcard" | "both" | "input";
export const TEST_METHOD_OPTIONS: TestMethod[] = ["flashcard", "both", "input"];
export const DEFAULT_TEST_METHODS: Record<Direction, TestMethod> = {
  meaning: "flashcard",
  reading: "input",
  writing: "input",
};

const methodKey = (d: Direction) => `settings.testMethod.${d}`;
const isMethod = (v: unknown): v is TestMethod =>
  v === "flashcard" || v === "input" || v === "both";

// The three facets' methods share one reactive object. Per-direction storage
// keys are kept for backward compatibility, but reads/writes go through the
// store so the review screen and the settings screen stay in lock-step.
function createMethodsStore() {
  let value: Record<Direction, TestMethod> = { ...DEFAULT_TEST_METHODS };
  let hydrated = false;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    Promise.all(DIRECTIONS.map((d) => AsyncStorage.getItem(methodKey(d)))).then((vals) => {
      const next = { ...value };
      let changed = false;
      DIRECTIONS.forEach((d, i) => {
        if (isMethod(vals[i])) {
          next[d] = vals[i] as TestMethod;
          changed = true;
        }
      });
      if (changed) {
        value = next;
        emit();
      }
    });
  };
  return {
    get: () => value,
    setOne: (d: Direction, m: TestMethod) => {
      value = { ...value, [d]: m };
      AsyncStorage.setItem(methodKey(d), m).catch(() => {});
      emit();
    },
    subscribe: (l: Listener) => {
      hydrate();
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
const methodsStore = createMethodsStore();

// All three facets' test methods. Used by the review screen (to pick how to show
// a card) and the settings screen (to edit them).
export function useTestMethods(): [
  Record<Direction, TestMethod>,
  (d: Direction, m: TestMethod) => void,
] {
  const value = useSyncExternalStore(methodsStore.subscribe, methodsStore.get, methodsStore.get);
  return [value, methodsStore.setOne];
}

// Resolve a facet's configured method into the concrete card type to show. A
// plain flashcard/input passes straight through; "both" is a flashcard while the
// card's interval is under the transition day, then a typed input once it hits.
export function resolveMethod(
  method: TestMethod,
  intervalDays: number,
  transitionDays: number,
): "flashcard" | "input" {
  if (method !== "both") return method;
  return intervalDays < transitionDays ? "flashcard" : "input";
}
