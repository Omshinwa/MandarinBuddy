import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  type Facet,
  type Grade,
  lenientVerdict,
  type MatchVerdict,
  type Srs,
  type Word,
} from "../../../../shared/src";
import { useTheme, type Theme } from "../../theme";
import { SpeakButton } from "../SpeakButton";
import { TextStyling } from "../TextStyling";

// Everything a card needs to render one facet, decoupled from HOW it's
// tested (flashcard vs. typed input). `facetView` builds it; FlashcardCard and
// InputCard consume it.
export interface FacetView {
  promptTop?: string; // pinyin shown above the question (a scaffold aid)
  question: string; // the big question text
  questionSize: number;
  promptSub?: string; // secondary aid under the question, hidden once answered
  promptNote?: string; // e.g. writing's "✍️ write the strokes", hidden once answered
  hint?: string; // optional "show hint" text before answering (writing's comments)
  check: (guess: string) => MatchVerdict; // input grading
  placeholder: string;
  inputSize?: number;
}

// Per-facet presentation. `scaffold` toggles the training-wheel aids; `fuzzy`
// only affects the reading match/placeholder; `minLen` is the input-leniency
// threshold (how many characters a typed answer must match).
export function facetView(
  word: Word,
  facet: Facet,
  scaffold: boolean,
  fuzzy: boolean,
  minLen: number,
): FacetView {
  switch (facet) {
    case "meaning":
      return {
        promptTop: scaffold ? word.pinyin : undefined,
        question: word.chinese,
        questionSize: 64,
        check: (g) => lenientVerdict(word.english, g, false, minLen),
        placeholder: "meaning",
      };
    case "reading":
      return {
        question: word.chinese,
        questionSize: 64,
        // Mature reading has no scaffold, so audio (the giveaway) stays off.
        promptSub: scaffold ? word.english : undefined,
        check: (g) => lenientVerdict(word.pinyin, g, fuzzy, minLen),
        placeholder: fuzzy ? "pinyin (lenient)" : "pinyin",
      };
    case "writing":
      return {
        // Pinyin shown only for handwriting; for typed writing it's the answer to copy.
        promptTop: scaffold && word.learn_writing ? word.pinyin : undefined,
        question: word.english,
        questionSize: 26,
        promptNote: word.learn_writing ? "✍️ write the strokes" : "⌨️ type it",
        hint: word.comments || undefined,
        check: (g) => lenientVerdict(word.chinese, g, false, minLen),
        placeholder: "中文",
        inputSize: 28,
      };
  }
}

export interface CardProps {
  view: FacetView;
  word: Word; // the reveal renders straight off this; word.chinese is what's spoken
  facet: Facet; // which facet is being tested — the reveal skips it as the question
  srs: Srs; // the tested facet's state — used to preview next intervals
  scaffold: boolean;
  onGrade: (grade: Grade) => void;
  // Sends the card back to the end of the session queue without grading it (its
  // due date resets to now) — the typed cards' "Actually I remember" escape
  // hatch. Unused by flashcards.
  onRequeue?: () => void;
  // Typed cards park their "Continue" here so the screen can fire it on a
  // tap-anywhere / Enter. Unused by flashcards.
  registerContinue?: (fn: (() => void) | null) => void;
  t: Theme;
}

// The sheet both card types are drawn on.
export function ReviewCard({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card }]}>{children}</View>;
}

// The question side, shared by both card types. `answered` hides the scaffold
// aids once the answer is on screen — the reveal below carries all of them.
export function PromptBlock({
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
      {!answered && !!view.promptTop && (
        <TextStyling text={view.promptTop} style={[styles.pinyinAbove, { color: t.subtext }]} />
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <TextStyling
          text={view.question}
          style={{ fontSize: view.questionSize, color: t.text, textAlign: "center" }}
        />
        {showSpeaker && <SpeakButton text={speakText} size={26} />}
      </View>
      {!answered && !!view.promptSub && (
        <TextStyling
          text={view.promptSub}
          style={{ fontSize: 17, color: t.subtext, textAlign: "center" }}
        />
      )}
      {!answered && !!view.promptNote && (
        <Text style={{ color: t.subtext, fontSize: 13 }}>{view.promptNote}</Text>
      )}
    </>
  );
}

// The reveal is the same whatever the facet and whatever the test: the whole
// word — character, pinyin, meaning, comment — so you always leave a card having
// seen the full picture. The only thing that varies is that the question isn't
// repeated: meaning/reading already show the character above, writing the
// meaning. The character carries the audio here (for meaning/reading the prompt
// carries it instead, since the character is up there).
export function AnswerBlock({
  word,
  facet,
  t,
}: {
  word: Word;
  facet: Facet;
  t: Theme;
}) {
  return (
    <>
      {facet === "writing" && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <TextStyling text={word.chinese} style={{ fontSize: 44, color: t.text }} />
          <SpeakButton text={word.chinese} size={20} />
        </View>
      )}
      <TextStyling text={word.pinyin} style={[styles.pinyinAnswer, { color: t.subtext }]} />
      {facet !== "writing" && (
        <TextStyling
          text={word.english}
          style={{ fontSize: 26, color: t.text, textAlign: "center" }}
        />
      )}
      {!!word.comments && (
        <TextStyling
          text={word.comments}
          style={{ fontSize: 17, color: t.subtext, textAlign: "center" }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 24, alignItems: "center", gap: 16, minHeight: 320 },
  pinyinAbove: { fontSize: 22, letterSpacing: 1, textAlign: "center", marginBottom: -8 },
  pinyinAnswer: { fontSize: 24, letterSpacing: 1, textAlign: "center" },
});
