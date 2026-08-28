import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Text } from "react-native";
import { isGlossable, type Word } from "../../../shared/src";
import { ChatThread, type EmptyStatus } from "../components/ChatThread";
import { api } from "../lib/api";

const REPO_URL = "https://github.com/Omshinwa/MandarinBuddy";

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
      enableReview
      // Short enough to stay on one line — a wrapped placeholder makes the box
      // two rows tall on a phone and pushes the buttons out of the bar.
      placeholder="Ask or chat in 中文…"
      // The status line changes with why the thread is empty; the repo link
      // sits under every one of them.
      emptyHint={(status: EmptyStatus) => (
        <>
          {status === "waking" && (
            <>The server is waking up (free hosting), this can take a few seconds.{"\n\n"}</>
          )}
          {status === "empty" && <>The chat is empty!{"\n\n"}</>}
          {status === "offline" && (
            <>Can't reach the server — it may be down.{"\n\n"}</>
          )}
          Github repo:{" "}
          <Text
            style={{ textDecorationLine: "underline" }}
            onPress={() => Linking.openURL(REPO_URL)}
          >
            {REPO_URL}
          </Text>
        </>
      )}
      gloss={{ words: glossWords, onReveal }}
      onWordAdded={loadWords}
    />
  );
}
