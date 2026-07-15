import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isGlossable } from "../../../shared/src/srs";
import type { Word } from "../../../shared/src/types";
import { ChatThread } from "../components/ChatThread";
import { api } from "../lib/api";

// The one place to talk to the AI: it acts as a tutor when you ask about words
// and as a conversation partner when you chat in Chinese. Dictionary words in AI
// messages are highlighted; tapping one reveals the gloss and applies
// conversation_missed (once per session). Words you use correctly earn credit.
export function ChatScreen() {
  const [words, setWords] = useState<Word[]>([]);
  const missedThisSession = useRef(new Set<string>());

  const loadWords = useCallback(() => {
    api.listWords().then(setWords).catch(() => {});
  }, []);

  useEffect(loadWords, [loadWords]);

  // Only gloss words you might still forget — very high-interval, well-known
  // words would just clutter every message with highlights.
  const glossWords = useMemo(() => words.filter((w) => isGlossable(w.srs)), [words]);

  const onReveal = useCallback((word: Word) => {
    if (missedThisSession.current.has(word._id)) return;
    missedThisSession.current.add(word._id);
    api.grade(word._id, "meaning", "conversation_missed").catch(() => {});
  }, []);

  return (
    <ChatThread
      mode="conversation"
      enableReview
      placeholder="Ask a word or chat in 中文…"
      emptyHint={
        "Your Chinese tutor & chat partner 🇨🇳\n\nAsk about anything, or just chat in Chinese to practice — the AI weaves in your vocabulary. Tap a highlighted word if you forget it.\n\nTap “Start a review session” to drill your due words."
      }
      gloss={{ words: glossWords, onReveal }}
      onWordAdded={loadWords}
    />
  );
}
