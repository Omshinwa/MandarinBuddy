import React, { useCallback, useEffect, useState } from "react";
import { useWindowKey } from "../../lib/web";
import { PrimaryButton } from "../Button";
import { speak } from "../SpeakButton";
import { AnswerBlock, PromptBlock, ReviewCard, type CardProps } from "./CardParts";
import { GradeButtons } from "./grades";

// Show the question, reveal the answer, and trust the user to self-grade. Any
// facet — the meaning card's original behaviour, generalized.
export function FlashcardCard({ view, word, facet, srs, scaffold, onGrade, t }: CardProps) {
  const [flipped, setFlipped] = useState(false);
  // Scaffolded: the word is read aloud up front.
  useEffect(() => {
    if (scaffold) speak(word.chinese);
  }, [scaffold, word.chinese]);

  const reveal = useCallback(() => {
    setFlipped(true);
    speak(word.chinese); // the answer is always read aloud
  }, [word.chinese]);

  // On desktop, Enter reveals the answer — the flashcard equivalent of the typed
  // cards' Enter-to-continue. Only while the question side is up; once flipped,
  // grading stays a deliberate click.
  useWindowKey("Enter", reveal, !flipped);

  return (
    <ReviewCard>
      {/* The speaker is fair game once scaffolded or flipped; a mature card
          must be answered before it reads the word aloud. Writing's prompt is
          English, so its speaker lives on the revealed character instead. */}
      <PromptBlock
        view={view}
        answered={flipped}
        showSpeaker={facet !== "writing" && (scaffold || flipped)}
        speakText={word.chinese}
        t={t}
      />
      {!flipped ? (
        <PrimaryButton label="Show answer" onPress={reveal} />
      ) : (
        <>
          <AnswerBlock word={word} facet={facet} t={t} />
          <GradeButtons srs={srs} onGrade={onGrade} t={t} />
        </>
      )}
    </ReviewCard>
  );
}
