import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type Facet,
  type Grade,
  type MatchVerdict,
  type Srs,
  type Word,
} from "../../../../shared/src";
import type { Theme } from "../../theme";
import { OutlineButton, PrimaryButton } from "../Button";
import { speak } from "../SpeakButton";
import { TextStyling } from "../TextStyling";
import { AnswerBlock, PromptBlock, ReviewCard, type CardProps } from "./CardParts";
import { gradeColor, gradeForTries, gradeLabel, previewLabel } from "./grades";

// Shared state machine for the two typed cards. A wrong answer no longer ends
// the card — it bumps the try count and lets the user keep going until they
// either type a match or give up (the red Forgot button). `outcome` is null
// while still answering.
function useTypedAnswer(check: (guess: string) => MatchVerdict) {
  const [answer, setAnswer] = useState("");
  const [wrongTries, setWrongTries] = useState(0);
  // Verdict of the last submit, cleared as soon as the user edits again. null =
  // nothing to nudge about; "partial" earns a friendlier message than "miss".
  const [lastMiss, setLastMiss] = useState<"partial" | "miss" | null>(null);
  const [outcome, setOutcome] = useState<{ grade: Grade; gaveUp: boolean } | null>(null);

  const giveUp = () => {
    Keyboard.dismiss();
    setOutcome({ grade: "reviewed_forgot", gaveUp: true });
  };
  const submit = () => {
    // Submitting an empty field (e.g. just hitting Enter) counts as giving up.
    if (!answer.trim()) return giveUp();
    const verdict = check(answer);
    if (verdict === "match") {
      // Dismiss the keyboard BEFORE unmounting the focused input: on the new
      // architecture, swapping it out under an open keyboard leaves the buttons
      // that replace it unresponsive to taps.
      Keyboard.dismiss();
      setOutcome({ grade: gradeForTries(wrongTries + 1), gaveUp: false });
    } else {
      setWrongTries((n) => n + 1);
      setLastMiss(verdict);
    }
  };
  const edit = (text: string) => {
    setAnswer(text);
    setLastMiss(null);
  };
  return { answer, edit, submit, giveUp, wrongTries, lastMiss, outcome };
}

// The input + Check + red Forgot controls, shared by both typed cards.
function TypedInput({
  answer,
  onEdit,
  onSubmit,
  onGiveUp,
  lastMiss,
  attempt,
  placeholder,
  fontSize,
  t,
}: {
  answer: string;
  onEdit: (text: string) => void;
  onSubmit: () => void;
  onGiveUp: () => void;
  lastMiss: "partial" | "miss" | null; // why the previous submit didn't pass
  attempt: number; // 1-based number of the attempt now being typed
  placeholder: string;
  fontSize?: number;
  t: Theme;
}) {
  const inputRef = useRef<TextInput | null>(null);
  const justWrong = lastMiss !== null;

  // A wrong answer leaves the field mounted with what you typed still in it, so
  // put the caret back at the end of it — otherwise the next attempt needs a
  // click first. (react-native-web is why: it blurs a single-line input on
  // Enter, which `blurOnSubmit={false}` below turns off; the explicit focus +
  // caret move covers the case where the miss came from tapping Check instead.)
  useEffect(() => {
    if (!justWrong) return;
    inputRef.current?.focus();
    const el = inputRef.current as unknown as HTMLInputElement | null;
    el?.setSelectionRange?.(el.value.length, el.value.length);
  }, [justWrong, attempt]);

  return (
    <>
      {/* A "partial" guess really is inside the answer — it only fell short of the
          leniency setting — so it gets encouragement, not a red ✗. */}
      {lastMiss === "partial" ? (
        <Text style={{ color: t.warning, fontWeight: "600" }}>
          You have part of the answer! (attempt {attempt})
        </Text>
      ) : lastMiss === "miss" ? (
        <Text style={{ color: t.danger, fontWeight: "600" }}>
          ✗ Not quite — try again (attempt {attempt})
        </Text>
      ) : null}
      <TextInput
        ref={inputRef}
        // fontSize goes in its own object: an inline `fontSize: undefined` would
        // override answerInput's size on native (RN's flattenStyle copies undefined
        // keys) while react-native-web quietly ignores it — same code, two sizes.
        style={[
          styles.answerInput,
          { backgroundColor: t.inputBg, color: t.text },
          fontSize != null && { fontSize },
        ]}
        value={answer}
        onChangeText={onEdit}
        placeholder={placeholder}
        placeholderTextColor={t.subtext}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        blurOnSubmit={false}
        onSubmitEditing={onSubmit}
      />
      {/* Check and Forgot sit together so the give-up option is under the thumb. */}
      <View style={styles.buttonGroup}>
        <PrimaryButton label="Check" onPress={onSubmit} disabled={!answer.trim()} />
        <OutlineButton label="Forgot" onPress={onGiveUp} color={t.danger} />
      </View>
    </>
  );
}

// Shown once a typed card is answered. The grade was decided by the app (from
// the try count, or Forgot if they gave up); the user sees which it was and can
// still knock it down to Forgot before continuing — or, after giving up, take it
// back and send the card round again ungraded.
function Result({
  outcome,
  tries,
  word,
  facet,
  srs,
  onCommit,
  onRequeue,
  registerContinue,
  t,
}: {
  outcome: { grade: Grade; gaveUp: boolean };
  tries: number;
  word: Word;
  facet: Facet;
  srs: Srs;
  onCommit: (grade: Grade) => void;
  onRequeue?: () => void;
  registerContinue?: (fn: (() => void) | null) => void;
  t: Theme;
}) {
  const { grade, gaveUp } = outcome;
  const color = gradeColor(t, grade);
  // The revealed answer is always read aloud, right or wrong.
  useEffect(() => {
    speak(word.chinese);
  }, [word.chinese]);
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
      <AnswerBlock word={word} facet={facet} t={t} />
      {/* Giving up needs no verdict line — the button below says what it commits. */}
      {!gaveUp && (
        <Text style={{ color, fontWeight: "800", fontSize: 16 }}>
          {gradeLabel(grade)} — got it in {tries} {tries === 1 ? "try" : "tries"}
        </Text>
      )}
      <PrimaryButton
        large
        color={color}
        label={gaveUp ? "Mark as Forgot" : `Continue · ${previewLabel(srs, grade)}`}
        onPress={() => onCommit(grade)}
      />
      {/* Take back the give-up: no grade is saved, the card just comes round
          again later this session (its due date resets to now). */}
      {gaveUp && !!onRequeue && (
        <Pressable onPress={onRequeue}>
          <Text style={{ color: t.subtext }}>← Actually I remember</Text>
        </Pressable>
      )}
      {!gaveUp && (
        <Pressable onPress={() => onCommit("reviewed_forgot")}>
          <Text style={{ color: t.subtext }}>I actually forgot →</Text>
        </Pressable>
      )}
    </>
  );
}

// Type the answer; the app grades from how many tries it took. Any facet —
// the reading/writing cards' original behaviour, generalized.
export function InputCard({
  view,
  word,
  facet,
  srs,
  scaffold,
  onGrade,
  onRequeue,
  registerContinue,
  t,
}: CardProps) {
  const { answer, edit, submit, giveUp, wrongTries, lastMiss, outcome } = useTypedAnswer(view.check);
  const [showHint, setShowHint] = useState(false);

  // Scaffolded: the word is read aloud up front (for reading that turns it into
  // "spell the pinyin of what you just heard", like the old site).
  useEffect(() => {
    if (scaffold) speak(word.chinese);
  }, [scaffold, word.chinese]);

  return (
    <ReviewCard>
      {/* Mature cards: no sound before answering — it would give the answer away.
          Once answered the character is fair game, unless it's the writing card's
          reveal, which carries its own speaker. */}
      <PromptBlock
        view={view}
        answered={!!outcome}
        showSpeaker={facet !== "writing" && (scaffold || !!outcome)}
        speakText={word.chinese}
        t={t}
      />
      {!!view.hint &&
        !outcome &&
        (showHint ? (
          <TextStyling text={view.hint} style={{ color: t.subtext, textAlign: "center" }} />
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
          lastMiss={lastMiss}
          attempt={wrongTries + 1}
          placeholder={view.placeholder}
          fontSize={view.inputSize}
          t={t}
        />
      ) : (
        <Result
          outcome={outcome}
          tries={wrongTries + 1}
          word={word}
          facet={facet}
          srs={srs}
          onCommit={onGrade}
          onRequeue={onRequeue}
          registerContinue={registerContinue}
          t={t}
        />
      )}
    </ReviewCard>
  );
}

const styles = StyleSheet.create({
  answerInput: {
    alignSelf: "stretch",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 25,
    textAlign: "center",
  },
  // Check + Forgot kept tight together.
  buttonGroup: { alignSelf: "stretch", gap: 8 },
});
