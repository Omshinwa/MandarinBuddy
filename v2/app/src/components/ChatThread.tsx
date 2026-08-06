import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChatMode, FlashcardProposal, Kickoff, Word } from "../../../shared/src/types";
import { api, streamChat } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useAutoSpeak, useUserLanguage } from "../lib/settings";
import { hasHardwareKeyboard } from "../lib/web";
import { useTheme } from "../theme";
import { FlashcardProposalCard } from "./FlashcardProposalCard";
import { GlossedText } from "./GlossedText";
import { speak } from "./SpeakButton";

// What to actually read aloud from an assistant message. The Google voice is
// Mandarin, so reading romanization and markup back is noise: strip markdown
// syntax and any parenthetical gloss — pinyin lives in "(tuījiàn)"-style parens
// (ASCII or full-width) per the tutor prompt. Inline prose is left alone.
function speakableText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [label](url) → label
    .replace(/^[ \t]*(?:#{1,6}|[-*•]|>)[ \t]+/gm, "") // line-leading heading/bullet/quote marks
    .replace(/[*`~]+/g, "") // *bold* / `code` / ~strike~ markers
    .replace(/[（(][^）)]*[）)]/g, "") // parenthetical pinyin gloss
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

type Item =
  | { id: string; kind: "msg"; role: "user" | "assistant"; content: string }
  | { id: string; kind: "card"; card: FlashcardProposal }
  | { id: string; kind: "credits"; chinese: string[] };

// Web Speech API (desktop Chrome/Edge): free speech-to-text for the mic button.
// Not available on iOS/WebKit or in native builds — the button only renders when
// the constructor exists. Typed structurally to avoid depending on DOM lib types.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((ev: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function getRecognitionCtor(): (new () => Recognition) | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => Recognition)
    | null;
}

interface GlossConfig {
  words: Word[];
  onReveal: (word: Word) => void;
}

// How tall the message box may grow before it starts scrolling instead.
const INPUT_MAX_HEIGHT = 120;

// A native multiline input is as tall as its content; on the web it's a
// <textarea>, which is a fixed two rows whatever you type — too tall for the
// bar's single row (it shoves the buttons around), and it never grows for a long
// message either. So drive its height from its own content: one row when empty,
// up to INPUT_MAX_HEIGHT. No-op on native, which already does this.
function useWebInputAutoGrow(ref: React.RefObject<TextInput | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current as unknown as HTMLTextAreaElement | null;
    if (Platform.OS !== "web" || !el?.style) return;
    el.rows = 1;
    el.style.height = "auto"; // let it collapse first, so it can shrink as well as grow
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [ref, value]);
}

// The small glyph buttons in the input bar (clear, mute, mic).
function IconButton({
  glyph,
  label,
  onPress,
  style,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  style?: { color?: string; opacity?: number };
}) {
  return (
    <Pressable style={styles.iconButton} hitSlop={6} onPress={onPress} accessibilityLabel={label}>
      <Text style={[styles.iconGlyph, style]}>{glyph}</Text>
    </Pressable>
  );
}

interface Props {
  mode: ChatMode;
  placeholder: string;
  emptyHint: string;
  gloss?: GlossConfig;
  onWordAdded?: () => void;
  enableReview?: boolean;
}

export function ChatThread({ mode, placeholder, emptyHint, gloss, onWordAdded, enableReview }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useAutoSpeak();
  const [userLanguage] = useUserLanguage();
  const [listening, setListening] = useState(false);
  // Content of the message whose long-press action menu (copy / speak) is open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const listRef = useRef<FlatList<Item>>(null);
  const inputRef = useRef<TextInput | null>(null);
  const nextId = useRef(0);
  const newId = () => `i${nextId.current++}`;

  useWebInputAutoGrow(inputRef, input);

  // Speech-to-text into the input box: tap 🎤, talk, the transcript fills the
  // field (live), review it, then send. Recognition stops itself on a pause.
  const speechCtor = getRecognitionCtor();
  const toggleMic = useCallback(() => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    if (!speechCtor) return;
    const rec = new speechCtor();
    recRef.current = rec;
    rec.lang = "zh-CN"; // practice-first: recognize Mandarin
    rec.interimResults = true;
    rec.continuous = false;
    const base = input.trim() ? `${input.trim()} ` : "";
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput(base + finalText + interim);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }, [listening, speechCtor, input]);

  // Don't leave the mic running if the screen unmounts mid-dictation.
  useEffect(() => () => recRef.current?.stop(), []);

  // Focusing the input opens the keyboard over the thread — scroll the last
  // message back into view once the keyboard is up so it isn't left hidden.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () =>
      listRef.current?.scrollToEnd({ animated: true }),
    );
    return () => sub.remove();
  }, []);

  useEffect(() => {
    api
      .chatHistory(mode)
      .then((msgs) =>
        setItems(
          msgs.map((m) => ({ id: newId(), kind: "msg", role: m.role, content: m.content })),
        ),
      )
      .catch(() => {
        // history is a nice-to-have; the thread still works without it
      });
  }, [mode]);

  const updateItem = (id: string, patch: (item: Item) => Item) =>
    setItems((prev) => prev.map((item) => (item.id === id ? patch(item) : item)));

  // Shared streaming path. A normal turn carries `message`; a banner tap carries
  // `kickoff` and no user bubble (the AI just answers — greeting the reviewer, or
  // handing over a sentence to translate).
  const runStream = useCallback(
    async ({ message, kickoff }: { message?: string; kickoff?: Kickoff }) => {
      if (busy) return;
      setBusy(true);

      if (message) {
        setItems((prev) => [...prev, { id: newId(), kind: "msg", role: "user", content: message }]);
      }
      let assistantId = newId();
      setItems((prev) => [...prev, { id: assistantId, kind: "msg", role: "assistant", content: "" }]);
      // Full reply text across bubble splits — spoken at the end when auto-read is on.
      let replyText = "";

      try {
        await streamChat(
          mode,
          message ?? "",
          (ev) => {
            switch (ev.type) {
              case "delta": {
                replyText += ev.text;
                updateItem(assistantId, (item) =>
                  item.kind === "msg" ? { ...item, content: item.content + ev.text } : item,
                );
                break;
              }
              case "flashcard": {
                // Close the current bubble; further text goes into a fresh one below the card.
                const cardItem: Item = { id: newId(), kind: "card", card: ev.card };
                assistantId = newId();
                setItems((prev) => [
                  ...prev,
                  cardItem,
                  { id: assistantId, kind: "msg", role: "assistant", content: "" },
                ]);
                break;
              }
              case "credits":
                setItems((prev) => [...prev, { id: newId(), kind: "credits", chinese: ev.chinese }]);
                break;
              case "review_mode":
                // The AI started/stopped a review from a natural-language request.
                setReviewing(ev.on);
                break;
              case "error":
                setItems((prev) => [
                  ...prev,
                  { id: newId(), kind: "msg", role: "assistant", content: `⚠️ ${ev.message}` },
                ]);
                break;
              case "done":
                break;
            }
          },
          { reviewing: kickoff === "review" ? true : reviewing, kickoff, userLanguage },
        );
        // Read the finished reply aloud (pinyin/emphasis stripped for speech).
        if (autoSpeak && replyText.trim()) speak(speakableText(replyText));
      } catch (err) {
        setItems((prev) => [
          ...prev,
          {
            id: newId(),
            kind: "msg",
            role: "assistant",
            content: `⚠️ ${err instanceof Error ? err.message : "connection failed"}`,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, mode, reviewing, autoSpeak, userLanguage],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    runStream({ message: text });
  }, [input, busy, runStream]);

  // Tap the review banner: start a session (AI greets) or stop it.
  const toggleReview = useCallback(() => {
    if (busy) return;
    if (reviewing) {
      setReviewing(false);
    } else {
      setReviewing(true);
      runStream({ kickoff: "review" });
    }
  }, [busy, reviewing, runStream]);

  // Tap the translation banner: the AI hands over one English sentence to render
  // in Chinese. Not a mode — it's a single turn, and the thread carries on from
  // the answer. During a review session the sentence is built from due words.
  const askForSentence = useCallback(() => {
    if (busy) return;
    runStream({ kickoff: "translate" });
  }, [busy, runStream]);

  const clear = async () => {
    if (!(await confirm("Clear conversation?"))) return;
    await api.clearChat(mode).catch(() => {});
    setItems([]);
  };

  const renderItem = ({ item }: { item: Item }) => {
    if (item.kind === "card") return <FlashcardProposalCard card={item.card} onAdded={onWordAdded} />;
    if (item.kind === "credits")
      return (
        <Text style={[styles.credits, { color: t.success }]}>
          ✨ practiced: {item.chinese.join("、")}
        </Text>
      );
    if (item.role === "assistant" && item.content === "")
      return busy ? <Text style={[styles.typing, { color: t.subtext }]}>…</Text> : null;

    const isUser = item.role === "user";
    return (
      <View style={[styles.bubbleRow, isUser && { justifyContent: "flex-end" }]}>
        <View
          style={[
            styles.bubble,
            isUser
              ? { backgroundColor: t.tint, borderBottomRightRadius: 4 }
              : { backgroundColor: t.card, borderBottomLeftRadius: 4 },
          ]}
        >
          {!isUser && gloss ? (
            <GlossedText
              text={item.content}
              words={gloss.words}
              onReveal={gloss.onReveal}
              fontSize={20}
              onLongPress={() => setMenuFor(item.content)}
            />
          ) : (
            <Text
              onLongPress={() => setMenuFor(item.content)}
              style={{ fontSize: 17, lineHeight: 24, color: isUser ? "#fff" : t.text }}
            >
              {item.content}
            </Text>
          )}
        </View>
        {/* Long-press doesn't survive mobile web (the browser claims the gesture
            for text selection), so assistant bubbles carry an explicit ⋯ button
            that opens the same copy/speak menu. */}
        {!isUser && (
          <Pressable
            style={styles.moreButton}
            hitSlop={8}
            onPress={() => setMenuFor(item.content)}
            accessibilityLabel="Message actions"
          >
            <Text style={[styles.moreGlyph, { color: t.subtext }]}>⋯</Text>
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.bg, paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {enableReview && (
        <>
          <Pressable
            onPress={toggleReview}
            disabled={busy}
            style={[
              styles.reviewBar,
              { borderBottomColor: t.border, backgroundColor: reviewing ? t.tint : t.card },
            ]}
          >
            <Text style={{ color: reviewing ? "#fff" : t.subtext, fontWeight: "600", fontSize: 13 }}>
              {reviewing ? "📖 Reviewing your words — tap to stop" : "📖 Start a review session"}
            </Text>
          </Pressable>
          <Pressable
            onPress={askForSentence}
            disabled={busy}
            style={[
              styles.reviewBar,
              { borderBottomColor: t.border, backgroundColor: t.card, opacity: busy ? 0.5 : 1 },
            ]}
          >
            <Text style={{ color: t.subtext, fontWeight: "600", fontSize: 13 }}>
              ✍️ Try and translate a sentence
            </Text>
          </Pressable>
        </>
      )}
      {items.length === 0 && (
        <Text style={[styles.hint, { color: t.subtext }]}>{emptyHint}</Text>
      )}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      />
      <View style={[styles.inputBar, { borderTopColor: t.border, backgroundColor: t.card }]}>
        <View style={styles.iconCluster}>
          <IconButton glyph="🗑" label="Clear conversation" onPress={clear} style={{ color: t.subtext }} />
          <IconButton
            glyph="🗣️"
            label={autoSpeak ? "Sound on — tap to mute" : "Muted — tap to unmute"}
            onPress={() => setAutoSpeak(!autoSpeak)}
            style={{ opacity: autoSpeak ? 1 : 0.3 }}
          />
        </View>
        <TextInput
          ref={inputRef}
          style={[styles.input, { backgroundColor: t.inputBg, color: t.text }]}
          value={input}
          onChangeText={setInput}
          placeholder={placeholder}
          placeholderTextColor={t.subtext}
          multiline
          onKeyPress={(e) => {
            // With a real keyboard Enter sends and Shift+Enter makes a newline —
            // but on a phone Return is the only newline key there is, so it always
            // inserts one and the ↑ button does the sending. Skip while an IME is
            // composing (typing Chinese) so Enter confirms the candidate instead.
            if (!hasHardwareKeyboard) return;
            const ne = e.nativeEvent as unknown as {
              key?: string;
              shiftKey?: boolean;
              isComposing?: boolean;
            };
            if (ne.key === "Enter" && !ne.shiftKey && !ne.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {speechCtor && (
          <IconButton
            glyph={listening ? "🔴" : "🎤"}
            label={listening ? "Stop dictation" : "Dictate a message"}
            onPress={toggleMic}
          />
        )}
        <Pressable
          style={[styles.sendButton, { backgroundColor: t.tint, opacity: busy || !input.trim() ? 0.4 : 1 }]}
          onPress={send}
          disabled={busy || !input.trim()}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>↑</Text>
        </Pressable>
      </View>

      <MessageActions
        content={menuFor}
        onClose={() => setMenuFor(null)}
        t={t}
      />
    </KeyboardAvoidingView>
  );
}

// Long-press action menu for a chat message: copy the text or read it aloud.
// A bottom sheet (rather than Alert) so it works the same on iOS, Android, and web.
function MessageActions({
  content,
  onClose,
  t,
}: {
  content: string | null;
  onClose: () => void;
  t: ReturnType<typeof useTheme>;
}) {
  if (content === null) return null;
  const copy = () => {
    Clipboard.setStringAsync(content).catch(() => {});
    onClose();
  };
  const say = () => {
    speak(speakableText(content), { force: true });
    onClose();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <View style={[styles.menuSheet, { backgroundColor: t.card }]}>
          <Pressable style={styles.menuItem} onPress={copy}>
            <Text style={[styles.menuText, { color: t.text }]}>📋  Copy</Text>
          </Pressable>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
          <Pressable style={styles.menuItem} onPress={say}>
            <Text style={[styles.menuText, { color: t.text }]}>📢  Speak</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.menuSheet, styles.menuCancel, { backgroundColor: t.card }]} onPress={onClose}>
          <Text style={[styles.menuText, { color: t.subtext }]}>Cancel</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  reviewBar: {
    paddingVertical: 8,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { padding: 12, gap: 8 },
  hint: { textAlign: "center", marginTop: 40, paddingHorizontal: 30, fontSize: 15 },
  // Bottom-aligned so the assistant row's ⋯ button sits level with the bubble's
  // last line rather than floating beside its middle.
  bubbleRow: { flexDirection: "row", alignItems: "flex-end" },
  bubble: {
    maxWidth: "85%",
    flexShrink: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  moreButton: { width: 30, height: 34, alignItems: "center", justifyContent: "center" },
  moreGlyph: { fontSize: 22, lineHeight: 24, fontWeight: "700" },
  credits: { textAlign: "center", fontSize: 13, marginVertical: 2 },
  typing: { fontSize: 24, paddingLeft: 16 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // The trash + mute icons cluster tightly on the left instead of floating as
  // two full-gap items. Each sits in a fixed box the height of the single-line
  // input and centers its glyph, so there's no stray space above it.
  iconCluster: { flexDirection: "row", alignItems: "center", gap: 2 },
  iconButton: { width: 30, height: 40, alignItems: "center", justifyContent: "center" },
  iconGlyph: { fontSize: 19, lineHeight: 22 },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
    maxHeight: INPUT_MAX_HEIGHT,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008", padding: 12, gap: 8 },
  menuSheet: { borderRadius: 14, overflow: "hidden" },
  menuItem: { paddingVertical: 16, alignItems: "center" },
  menuText: { fontSize: 17, fontWeight: "600" },
  menuCancel: { paddingVertical: 16, alignItems: "center" },
});
