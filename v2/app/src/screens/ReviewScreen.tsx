import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { answerContains, pinyinContains } from "../../../shared/src/pinyin";
import { applyGrade, isScaffolded } from "../../../shared/src/srs";
import type { Direction, Grade, ReviewItem, Srs, Word } from "../../../shared/src/types";
import { MilestoneOverlay } from "../components/MilestoneOverlay";
import { SpeakButton, speak } from "../components/SpeakButton";
import { api } from "../lib/api";
import {
  leniencyMinLen,
  useFuzzyPinyin,
  useInputLeniency,
  useReviewBatch,
  useScaffoldMaxDays,
  useTestMethods,
} from "../lib/settings";
import { useTheme, type Theme } from "../theme";

const DIRECTION_BADGE = { meaning: "🧠 meaning", reading: "🗣️ reading", writing: "✍️ writing" };

// The screen shifts hue and deepens with each correct answer — a "you're on a
// roll" signal that ramps to full color over ~STREAK_FULL good answers. Starts
// from a random hue each session so no two runs look the same. Saturation AND
// lightness both move (a near-white wash hides added saturation), reaching a
// still-readable tint — the card sits on top with its own background.
const STREAK_FULL = 12;
function streakBg(correct: number, baseHue: number, t: Theme): string {
  if (correct === 0) return t.bg;
  const k = Math.min(1, correct / STREAK_FULL); // 0 → 1 progress into the streak
  const hue = Math.round((baseHue + correct * 13) % 360);
  const sat = Math.round(22 + (t.dark ? 33 : 55) * k);
  const light = Math.round(t.dark ? 12 + 13 * k : 94 - 20 * k);
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

// Flashcard review only — conversation practice now lives in the Chat tab.
export function ReviewScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [fuzzy, setFuzzy] = useFuzzyPinyin();
  const [methods] = useTestMethods();
  const [scaffoldMaxDays] = useScaffoldMaxDays();
  const [leniency] = useInputLeniency();
  // One knob for the session rhythm: how many same-type cards the server serves
  // in a row AND how many cards between celebration overlays.
  const [reviewBatch] = useReviewBatch();
  const [phase, setPhase] = useState<"loading" | "empty" | "active" | "done">("loading");
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0); // good answers (drives the streak color)
  const [milestone, setMilestone] = useState<number | null>(null); // celebration to show, if any
  const [baseHue, setBaseHue] = useState(() => Math.floor(Math.random() * 360));
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setPhase("loading");
    setSaveError(null);
    api
      .reviewQueue(reviewBatch)
      .then((items) => {
        setQueue(items);
        setIdx(0);
        setReviewed(0);
        setCorrect(0);
        setMilestone(null);
        setBaseHue(Math.floor(Math.random() * 360));
        setPhase(items.length ? "active" : "empty");
      })
      .catch(() => setPhase("empty"));
  }, [reviewBatch]);

  useEffect(load, [load]);

  const grade = useCallback(
    (item: ReviewItem, g: Grade) => {
      // Surface save failures instead of swallowing them: a dropped grade means
      // the card is still due on the next reload, which looks like the app
      // "forgot" your answer.
      api.grade(item.word._id, item.direction, g).then(
        () => setSaveError(null),
        (err) =>
          setSaveError(
            `Couldn't save your last answer — ${
              err instanceof Error ? err.message : "request failed"
            }. Is the server (port 6767) running?`,
          ),
      );
      const feedback =
        g === "reviewed_forgot"
          ? Haptics.NotificationFeedbackType.Error
          : g === "reviewed_hard"
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success;
      Haptics.notificationAsync(feedback).catch(() => {});
      // Celebrate every `reviewBatch` cards reviewed — the same count as the
      // server's queue batch, so a party lands as you finish a batch and switch
      // exercise type — shown in place of the next card.
      const nextReviewed = reviewed + 1;
      setReviewed(nextReviewed);
      if (nextReviewed % reviewBatch === 0) setMilestone(nextReviewed);
      // A "good" answer (anything but Forgot) still grows the streak color.
      if (g !== "reviewed_forgot") setCorrect((c) => c + 1);
      setQueue((prev) => {
        // Forgot → re-show this session, UNLESS this lapse just turned the card
        // into a leech (suspended) — then it leaves the session for good.
        const graded = applyGrade(item.word.srs, g, new Date());
        const requeue = g === "reviewed_forgot" && !graded.suspended;
        const next = requeue ? [...prev, item] : prev;
        if (idx + 1 >= next.length) setPhase("done");
        return next;
      });
      setIdx((i) => i + 1);
    },
    [idx, reviewed, reviewBatch],
  );

  // A typed card in its answered state parks its "Continue" action here so the
  // user can commit it without aiming for the button — by tapping anywhere in
  // the card area, or (on web) pressing Enter. Null while there's nothing to
  // commit (still answering, or a meaning card).
  const continueRef = useRef<(() => void) | null>(null);
  const registerContinue = useCallback((fn: (() => void) | null) => {
    continueRef.current = fn;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && continueRef.current) {
        e.preventDefault();
        continueRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A milestone takes over the whole screen until dismissed — shown in place of
  // the next card, so it interrupts the flow rather than layering over it.
  if (milestone !== null)
    return <MilestoneOverlay count={milestone} onContinue={() => setMilestone(null)} t={t} />;

  if (phase === "loading")
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );

  if (phase === "empty")
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 40 }}>🌤</Text>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>Nothing due right now</Text>
        <Text style={{ color: t.subtext, textAlign: "center", paddingHorizontal: 40 }}>
          Add words from the Chat tab, or come back when reviews are due.
        </Text>
        <RetryButton label="Refresh" onPress={load} />
      </View>
    );

  if (phase === "done")
    return (
      <View style={[styles.center, { backgroundColor: streakBg(correct, baseHue, t) }]}>
        <Text style={{ fontSize: 40 }}>🎉</Text>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>
          Session complete — {reviewed} cards reviewed
        </Text>
        {correct > 0 && (
          <Text style={{ color: t.subtext, fontSize: 15 }}>{correct} answered correctly</Text>
        )}
        <RetryButton label="Check for more" onPress={load} />
      </View>
    );

  const item = queue[idx];
  // Young cards get training wheels (pinyin, auto-played audio); mature cards
  // must be answered from the characters alone.
  const scaffold = isScaffolded(item.word.srs, scaffoldMaxDays);
  const method = methods[item.direction];
  const view = facetView(item.word, item.direction, scaffold, fuzzy, leniencyMinLen(leniency));
  // Fuzzy only bites on a typed reading test — hide the toggle otherwise.
  const showFuzzyToggle = item.direction === "reading" && method === "input";
  return (
    <ScrollView
      style={{ backgroundColor: streakBg(correct, baseHue, t) }}
      contentContainerStyle={[styles.cardArea, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      {/* Behind everything: tapping the empty area around/below the card drops the
          keyboard (while typing) and commits a typed card's parked Continue (no-op
          otherwise). Sits underneath so the card's own buttons keep their taps —
          and, on web, don't bubble into it. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          Keyboard.dismiss();
          continueRef.current?.();
        }}
      />
      {saveError && (
        <Text style={[styles.saveError, { backgroundColor: t.danger }]}>{saveError}</Text>
      )}
      <View style={styles.metaRow}>
        <Text style={{ color: t.subtext }}>
          {Math.min(idx + 1, queue.length)} / {queue.length}
        </Text>
        <Text style={{ color: t.subtext }}>{DIRECTION_BADGE[item.direction]}</Text>
        {showFuzzyToggle ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ color: t.subtext, fontSize: 12 }}>fuzzy</Text>
            <Switch value={fuzzy} onValueChange={setFuzzy} />
          </View>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>
      {method === "flashcard" ? (
        <FlashcardCard
          key={item.word._id + idx}
          view={view}
          word={item.word}
          srs={item.word.srs}
          scaffold={scaffold}
          onGrade={(g) => grade(item, g)}
          t={t}
        />
      ) : (
        <InputCard
          key={item.word._id + idx}
          view={view}
          word={item.word}
          srs={item.word.srs}
          scaffold={scaffold}
          onGrade={(g) => grade(item, g)}
          registerContinue={registerContinue}
          t={t}
        />
      )}
    </ScrollView>
  );
}

// Everything a card needs to render one direction, decoupled from HOW it's
// tested (flashcard vs. typed input). `facetView` builds it; FlashcardCard and
// InputCard consume it.
interface FacetView {
  promptTop?: string; // pinyin shown above the question (a scaffold aid)
  question: string; // the big question text
  questionSize: number;
  promptSub?: string; // secondary aid under the question, hidden once answered
  promptNote?: string; // e.g. writing's "✍️ write the strokes", hidden once answered
  hint?: string; // optional "show hint" text before answering (writing's comments)
  answerLines: string[]; // revealed answer; [0] is primary, the rest are subtext
  answerSize: number;
  match: (guess: string) => boolean; // input grading
  placeholder: string;
  inputSize?: number;
}

// Per-direction presentation. `scaffold` toggles the training-wheel aids; `fuzzy`
// only affects the reading match/placeholder; `minLen` is the input-leniency
// threshold (how many characters a typed answer must match).
function facetView(
  word: Word,
  direction: Direction,
  scaffold: boolean,
  fuzzy: boolean,
  minLen: number,
): FacetView {
  switch (direction) {
    case "meaning":
      return {
        promptTop: scaffold ? word.pinyin : undefined,
        question: word.chinese,
        questionSize: 64,
        answerLines: word.comments ? [word.def_english, word.comments] : [word.def_english],
        answerSize: 30,
        match: (g) => answerContains(word.def_english, g, minLen),
        placeholder: "meaning",
      };
    case "reading":
      return {
        question: word.chinese,
        questionSize: 64,
        // Mature reading has no scaffold, so audio (the giveaway) stays off.
        promptSub: scaffold ? word.def_english : undefined,
        answerLines: [word.pinyin, word.def_english],
        answerSize: 26,
        match: (g) => pinyinContains(word.pinyin, g, fuzzy, minLen),
        placeholder: fuzzy ? "pinyin (lenient)" : "pinyin",
      };
    case "writing":
      return {
        // Pinyin shown only for handwriting; for typed writing it's the answer to copy.
        promptTop: scaffold && word.learn_writing ? word.pinyin : undefined,
        question: word.def_english,
        questionSize: 26,
        promptNote: word.learn_writing ? "✍️ write the strokes" : "⌨️ type it",
        hint: word.comments || undefined,
        answerLines: [word.chinese, word.pinyin],
        answerSize: 44,
        match: (g) => answerContains(word.chinese, g, minLen),
        placeholder: "中文",
        inputSize: 28,
      };
  }
}

interface CardProps {
  view: FacetView;
  word: Word; // only for audio (word.chinese is always what's spoken)
  srs: Srs; // the tested direction's state — used to preview next intervals
  scaffold: boolean;
  onGrade: (grade: Grade) => void;
  // Typed cards park their "Continue" here so the screen can fire it on a
  // tap-anywhere / Enter. Unused by flashcards.
  registerContinue?: (fn: (() => void) | null) => void;
  t: Theme;
}

// The question side, shared by both card types. `answered` hides the scaffold
// aids (meaning/stroke hints) once the answer is on screen; the pinyin above
// stays, since it's never the giveaway where it's shown.
function PromptBlock({
  view,
  answered,
  showSpeaker,
  speakText,
  t,
}: {
  view: FacetView;
  answered: boolean;
  showSpeaker: boolean;
  speakText: string;
  t: Theme;
}) {
  return (
    <>
      {!!view.promptTop && (
        <Text style={[styles.pinyinAbove, { color: t.subtext }]}>{view.promptTop}</Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Text style={{ fontSize: view.questionSize, color: t.text, textAlign: "center" }}>
          {view.question}
        </Text>
        {showSpeaker && <SpeakButton text={speakText} size={26} />}
      </View>
      {!answered && !!view.promptSub && (
        <Text style={{ fontSize: 17, color: t.subtext, textAlign: "center" }}>{view.promptSub}</Text>
      )}
      {!answered && !!view.promptNote && (
        <Text style={{ color: t.subtext, fontSize: 13 }}>{view.promptNote}</Text>
      )}
    </>
  );
}

// Show the question, reveal the answer, and trust the user to self-grade. Any
// direction — the meaning card's original behaviour, generalized.
function FlashcardCard({ view, word, srs, scaffold, onGrade, t }: CardProps) {
  const [flipped, setFlipped] = useState(false);
  // Scaffolded: the word is read aloud up front.
  useEffect(() => {
    if (scaffold) speak(word.chinese);
  }, [scaffold, word.chinese]);

  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      {/* The speaker is fair game once scaffolded or flipped; a mature card
          must be answered before it reads the word aloud. */}
      <PromptBlock
        view={view}
        answered={flipped}
        showSpeaker={scaffold || flipped}
        speakText={word.chinese}
        t={t}
      />
      {!flipped ? (
        <Pressable
          style={[styles.primaryButton, { backgroundColor: t.tint }]}
          onPress={() => {
            setFlipped(true);
            speak(word.chinese); // the answer is always read aloud
          }}
        >
          <Text style={styles.primaryButtonText}>Show answer</Text>
        </Pressable>
      ) : (
        <>
          <Text style={{ fontSize: view.answerSize, color: t.text, textAlign: "center" }}>
            {view.answerLines[0]}
          </Text>
          {view.answerLines.slice(1).map((line, i) => (
            <Text key={i} style={{ fontSize: 18, color: t.subtext, textAlign: "center" }}>
              {line}
            </Text>
          ))}
          <GradeButtons srs={srs} onGrade={onGrade} t={t} />
        </>
      )}
    </View>
  );
}

// Reading & writing are typed tests, so the app grades them from how many tries
// the answer took instead of asking: 1 try = Easy, 2–3 = Okay, 4+ = Hard.
function gradeForTries(tries: number): Grade {
  if (tries === 1) return "reviewed_easy";
  if (tries <= 3) return "reviewed_remembered";
  return "reviewed_hard";
}

function gradeLabel(g: Grade): string {
  return g === "reviewed_easy"
    ? "Easy"
    : g === "reviewed_remembered"
      ? "Okay"
      : g === "reviewed_hard"
        ? "Hard"
        : "Forgot";
}

function gradeColor(t: Theme, g: Grade): string {
  return g === "reviewed_forgot"
    ? t.danger
    : g === "reviewed_hard"
      ? t.warning
      : g === "reviewed_remembered"
        ? t.success
        : t.tint;
}

// Shared state machine for the two typed cards. A wrong answer no longer ends
// the card — it bumps the try count and lets the user keep going until they
// either type a match or give up (the red Forgot button). `outcome` is null
// while still answering.
function useTypedAnswer(match: (guess: string) => boolean) {
  const [answer, setAnswer] = useState("");
  const [wrongTries, setWrongTries] = useState(0);
  const [justWrong, setJustWrong] = useState(false); // last submit missed → "try again" nudge
  const [outcome, setOutcome] = useState<{ grade: Grade; gaveUp: boolean } | null>(null);

  const giveUp = () => {
    Keyboard.dismiss();
    setOutcome({ grade: "reviewed_forgot", gaveUp: true });
  };
  const submit = () => {
    // Submitting an empty field (e.g. just hitting Enter) counts as giving up.
    if (!answer.trim()) return giveUp();
    if (match(answer)) {
      // Dismiss the keyboard BEFORE unmounting the focused input: on the new
      // architecture, swapping it out under an open keyboard leaves the buttons
      // that replace it unresponsive to taps.
      Keyboard.dismiss();
      setOutcome({ grade: gradeForTries(wrongTries + 1), gaveUp: false });
    } else {
      setWrongTries((n) => n + 1);
      setJustWrong(true);
    }
  };
  const edit = (text: string) => {
    setAnswer(text);
    setJustWrong(false);
  };
  return { answer, edit, submit, giveUp, wrongTries, justWrong, outcome };
}

// The input + Check + red Forgot controls, shared by both typed cards.
function TypedInput({
  answer,
  onEdit,
  onSubmit,
  onGiveUp,
  justWrong,
  attempt,
  placeholder,
  fontSize,
  t,
}: {
  answer: string;
  onEdit: (text: string) => void;
  onSubmit: () => void;
  onGiveUp: () => void;
  justWrong: boolean;
  attempt: number; // 1-based number of the attempt now being typed
  placeholder: string;
  fontSize?: number;
  t: Theme;
}) {
  return (
    <>
      {justWrong && (
        <Text style={{ color: t.danger, fontWeight: "600" }}>
          ✗ Not quite — try again (attempt {attempt})
        </Text>
      )}
      <TextInput
        style={[styles.answerInput, { backgroundColor: t.inputBg, color: t.text, fontSize }]}
        value={answer}
        onChangeText={onEdit}
        placeholder={placeholder}
        placeholderTextColor={t.subtext}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        onSubmitEditing={onSubmit}
      />
      {/* Check and Forgot sit together so the give-up option is under the thumb. */}
      <View style={styles.buttonGroup}>
        <Pressable
          style={[styles.primaryButton, { backgroundColor: t.tint, opacity: answer.trim() ? 1 : 0.4 }]}
          onPress={onSubmit}
          disabled={!answer.trim()}
        >
          <Text style={styles.primaryButtonText}>Check</Text>
        </Pressable>
        <Pressable style={[styles.forgotButton, { borderColor: t.danger }]} onPress={onGiveUp}>
          <Text style={{ color: t.danger, fontWeight: "700" }}>Forgot</Text>
        </Pressable>
      </View>
    </>
  );
}

// Type the answer; the app grades from how many tries it took. Any direction —
// the reading/writing cards' original behaviour, generalized.
function InputCard({ view, word, srs, scaffold, onGrade, registerContinue, t }: CardProps) {
  const { answer, edit, submit, giveUp, wrongTries, justWrong, outcome } = useTypedAnswer(view.match);
  const [showHint, setShowHint] = useState(false);

  // Scaffolded: the word is read aloud up front (for reading that turns it into
  // "spell the pinyin of what you just heard", like the old site).
  useEffect(() => {
    if (scaffold) speak(word.chinese);
  }, [scaffold, word.chinese]);

  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      {/* Mature cards: no sound before answering — it would give the answer away */}
      <PromptBlock
        view={view}
        answered={!!outcome}
        showSpeaker={scaffold && !outcome}
        speakText={word.chinese}
        t={t}
      />
      {!!view.hint &&
        !outcome &&
        (showHint ? (
          <Text style={{ color: t.subtext, textAlign: "center" }}>{view.hint}</Text>
        ) : (
          <Pressable onPress={() => setShowHint(true)}>
            <Text style={{ color: t.tint }}>show hint</Text>
          </Pressable>
        ))}
      {!outcome ? (
        <TypedInput
          answer={answer}
          onEdit={edit}
          onSubmit={submit}
          onGiveUp={giveUp}
          justWrong={justWrong}
          attempt={wrongTries + 1}
          placeholder={view.placeholder}
          fontSize={view.inputSize}
          t={t}
        />
      ) : (
        <Result
          outcome={outcome}
          tries={wrongTries + 1}
          lines={view.answerLines}
          answerSize={view.answerSize}
          speakText={word.chinese}
          srs={srs}
          onCommit={onGrade}
          registerContinue={registerContinue}
          t={t}
        />
      )}
    </View>
  );
}

// Shown once a typed card is answered. The grade was decided by the app (from
// the try count, or Forgot if they gave up); the user sees which it was and can
// still knock it down to Forgot before continuing.
function Result({
  outcome,
  tries,
  lines,
  answerSize = 26,
  speakText,
  srs,
  onCommit,
  registerContinue,
  t,
}: {
  outcome: { grade: Grade; gaveUp: boolean };
  tries: number;
  lines: string[];
  answerSize?: number; // size of the primary answer line (bigger for hanzi)
  speakText: string;
  srs: Srs;
  onCommit: (grade: Grade) => void;
  registerContinue?: (fn: (() => void) | null) => void;
  t: Theme;
}) {
  const { grade, gaveUp } = outcome;
  const color = gradeColor(t, grade);
  // The revealed answer is always read aloud, right or wrong.
  useEffect(() => {
    speak(speakText);
  }, [speakText]);
  // Park Continue with the screen (for tap-anywhere / Enter) while shown; the
  // capture happens on mount, so it stays the auto-grade even if the user later
  // taps "I actually forgot" (that's an explicit, separate commit).
  useEffect(() => {
    registerContinue?.(() => onCommit(grade));
    return () => registerContinue?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={{ fontSize: answerSize, color: t.text }}>{lines[0]}</Text>
        <SpeakButton text={speakText} size={20} />
      </View>
      <Text style={{ fontSize: 18, color: t.subtext }}>{lines[1]}</Text>
      <Text style={{ color, fontWeight: "800", fontSize: 16 }}>
        {gaveUp
          ? "Marked as Forgot"
          : `${gradeLabel(grade)} — got it in ${tries} ${tries === 1 ? "try" : "tries"}`}
      </Text>
      <Pressable style={[styles.continueButton, { backgroundColor: color }]} onPress={() => onCommit(grade)}>
        <Text style={styles.continueButtonText}>Continue · {previewLabel(srs, grade)}</Text>
      </Pressable>
      {!gaveUp && (
        <Pressable onPress={() => onCommit("reviewed_forgot")}>
          <Text style={{ color: t.subtext }}>I actually forgot →</Text>
        </Pressable>
      )}
    </>
  );
}

const GRADE_BUTTONS: { grade: Grade; label: string }[] = [
  { grade: "reviewed_forgot", label: "Forgot" },
  { grade: "reviewed_hard", label: "Hard" },
  { grade: "reviewed_remembered", label: "Okay" },
  { grade: "reviewed_easy", label: "Easy" },
];

// "🐢 leech" if this grade suspends the card, "now" for re-shown-this-session,
// otherwise the projected next interval.
function previewLabel(srs: Srs, grade: Grade): string {
  const next = applyGrade(srs, grade, new Date());
  if (next.suspended && !srs.suspended) return "🐢 leech";
  if (next.due <= new Date().toISOString()) return "now";
  return next.intervalDays < 1 ? "<1d" : `${Math.round(next.intervalDays)}d`;
}

function GradeButtons({ srs, onGrade, t }: { srs: Srs; onGrade: (g: Grade) => void; t: Theme }) {
  const colors: Record<string, string> = {
    reviewed_forgot: t.danger,
    reviewed_hard: t.warning,
    reviewed_remembered: t.success,
    reviewed_easy: t.tint,
  };
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 8, alignSelf: "stretch" }}>
      {GRADE_BUTTONS.map(({ grade, label }) => (
        <Pressable
          key={grade}
          style={[styles.gradeButton, { backgroundColor: colors[grade] }]}
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

function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable style={[styles.primaryButton, { backgroundColor: t.tint, marginTop: 12 }]} onPress={onPress}>
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  cardArea: { padding: 16, gap: 12, flexGrow: 1 },
  saveError: { color: "#fff", fontSize: 13, borderRadius: 10, padding: 10, overflow: "hidden" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  card: { borderRadius: 20, padding: 24, alignItems: "center", gap: 16, minHeight: 320 },
  pinyinAbove: { fontSize: 22, letterSpacing: 1, textAlign: "center", marginBottom: -8 },
  answerInput: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 25,
    textAlign: "center",
  },
  primaryButton: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  // Check + Forgot kept tight together.
  buttonGroup: { alignSelf: "stretch", gap: 8 },
  forgotButton: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: "center",
    borderWidth: 1.5,
  },
  // Big, thumb-friendly commit button on the answered screen.
  continueButton: {
    alignSelf: "stretch",
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
  },
  continueButtonText: { color: "#fff", fontWeight: "800", fontSize: 19 },
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
