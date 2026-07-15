import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { FlashcardProposal } from "../../../shared/src/types";
import { ApiError, api } from "../lib/api";
import { useTheme } from "../theme";

type Status = "collapsed" | "pending" | "added" | "exists" | "dismissed" | "error";

interface Props {
  card: FlashcardProposal;
  onAdded?: () => void;
}

// Inline card preview rendered when the AI calls propose_flashcard. Starts as a
// compact "Add 频率 card?" button; tapping it expands the editable preview.
export function FlashcardProposalCard({ card, onAdded }: Props) {
  const t = useTheme();
  const [status, setStatus] = useState<Status>("collapsed");
  const [chinese, setChinese] = useState(card.chinese);
  const [pinyin, setPinyin] = useState(card.pinyin);
  const [english, setEnglish] = useState(card.english);
  const [example, setExample] = useState(card.example);

  const add = async () => {
    try {
      await api.createWord({
        chinese,
        pinyin,
        def_english: english,
        comments: example,
        learn_writing: false,
      });
      setStatus("added");
      onAdded?.();
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 409 ? "exists" : "error");
    }
  };

  if (status === "dismissed") return null;

  // Step one: a single compact button under the AI message. Tapping it reveals
  // the full editable card (step two) with Add / Dismiss.
  if (status === "collapsed") {
    return (
      <Pressable
        style={[styles.collapsed, { backgroundColor: t.success }]}
        onPress={() => setStatus("pending")}
      >
        <Text style={styles.buttonText}>✓ Add {chinese} card?</Text>
      </Pressable>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: t.inputBg, color: t.text, borderColor: t.border },
  ];

  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.tint }]}>
      <Text style={[styles.label, { color: t.subtext }]}>🎴 New flashcard</Text>
      {status === "pending" ? (
        <>
          <TextInput style={[inputStyle, styles.big]} value={chinese} onChangeText={setChinese} />
          <TextInput style={inputStyle} value={pinyin} onChangeText={setPinyin} />
          <TextInput style={inputStyle} value={english} onChangeText={setEnglish} />
          <TextInput style={inputStyle} value={example} onChangeText={setExample} multiline />
          <View style={styles.row}>
            <Pressable
              style={[styles.button, { backgroundColor: t.success }]}
              onPress={add}
              disabled={!chinese.trim() || !pinyin.trim() || !english.trim()}
            >
              <Text style={styles.buttonText}>✓ Add</Text>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: t.inputBg }]}
              onPress={() => setStatus("dismissed")}
            >
              <Text style={[styles.buttonText, { color: t.subtext }]}>Dismiss</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View>
          <Text style={[styles.big, { color: t.text }]}>
            {chinese} <Text style={{ fontSize: 15, color: t.subtext }}>{pinyin}</Text>
          </Text>
          <Text
            style={{
              color: status === "added" ? t.success : status === "exists" ? t.subtext : t.danger,
              marginTop: 4,
            }}
          >
            {status === "added"
              ? "✓ Added to dictionary"
              : status === "exists"
                ? "Already in your dictionary"
                : "Could not save — is the server running?"}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 14, padding: 12, marginVertical: 6, gap: 6 },
  collapsed: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginVertical: 6,
  },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase" },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  big: { fontSize: 24 },
  row: { flexDirection: "row", gap: 10, marginTop: 4 },
  button: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
