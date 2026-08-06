import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { BUCKETS, intervalBucket, isDue, isSuspended } from "../../../shared/src/srs";
import { DIRECTIONS } from "../../../shared/src/types";
import type { Word, WordInput } from "../../../shared/src/types";
import { ApiError, api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useTheme, type Theme } from "../theme";

const DAY_MS = 24 * 60 * 60 * 1000;

// Strip tone marks / accents so a search for "ai" matches pinyin like "ài".
// NFD splits an accented letter into base + combining marks, then we drop the marks.
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// A word is a leech when its card got suspended after too many lapses.
function isLeech(w: Word): boolean {
  return isSuspended(w.srs);
}

function dueLabel(w: Word, now: Date): { text: string; due: boolean } {
  if (isLeech(w)) return { text: "leech", due: false };
  const days = (new Date(w.srs.due).getTime() - now.getTime()) / DAY_MS;
  if (days <= 0) return { text: "due", due: true };
  if (days < 1) return { text: "today", due: false };
  return { text: `in ${Math.ceil(days)}d`, due: false };
}

export function WordsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [words, setWords] = useState<Word[]>([]);
  const [search, setSearch] = useState("");
  const [bucketFilter, setBucketFilter] = useState<number | null>(null);
  const [leechOnly, setLeechOnly] = useState(false);
  const [sheet, setSheet] = useState<{ mode: "add" } | { mode: "edit"; word: Word } | null>(null);

  const load = useCallback(() => {
    api.listWords().then(setWords).catch(() => {});
  }, []);

  useFocusEffect(load);

  const now = new Date();
  const filtered = useMemo(() => {
    const q = fold(search.trim());
    return words.filter((w) => {
      if (leechOnly && !isLeech(w)) return false;
      if (bucketFilter !== null && intervalBucket(w.srs.intervalDays) !== bucketFilter) return false;
      if (!q) return true;
      return (
        w.chinese.includes(q) ||
        fold(w.pinyin).includes(q) ||
        fold(w.def_english).includes(q)
        // || fold(w.comments).includes(q)
      );
    });
  }, [words, search, bucketFilter, leechOnly]);

  const leechCount = useMemo(() => words.filter(isLeech).length, [words]);

  // With no search and no filter the list is just "every word you own" — a wall
  // of rows nobody scrolls. Show the interval distribution instead.
  const showStats = !search.trim() && bucketFilter === null && !leechOnly;

  // If the last leech gets reactivated while its filter is on, drop back to "all"
  // so you're not left staring at an empty list with a vanished chip.
  useEffect(() => {
    if (leechOnly && leechCount === 0) setLeechOnly(false);
  }, [leechOnly, leechCount]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={styles.header}>
        <TextInput
          style={[styles.search, { backgroundColor: t.inputBg, color: t.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${words.length} words…`}
          placeholderTextColor={t.subtext}
          autoCapitalize="none"
        />
        <Pressable style={[styles.addButton, { backgroundColor: t.tint }]} onPress={() => setSheet({ mode: "add" })}>
          <Text style={{ color: "#fff", fontSize: 24, lineHeight: 26 }}>＋</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.chips}>
        <Chip
          label="all"
          color={t.card}
          active={bucketFilter === null && !leechOnly}
          onPress={() => {
            setBucketFilter(null);
            setLeechOnly(false);
          }}
          t={t}
        />
        {leechCount > 0 && (
          <Chip
            label={`🐢 ${leechCount}`}
            color="#ffe0e0"
            active={leechOnly}
            onPress={() => {
              setLeechOnly((v) => !v);
              setBucketFilter(null);
            }}
            t={t}
          />
        )}
        {BUCKETS.map((b, i) => (
          <Chip
            key={i}
            label={b.label}
            color={b.color}
            active={bucketFilter === i && !leechOnly}
            onPress={() => {
              setLeechOnly(false);
              setBucketFilter(bucketFilter === i ? null : i);
            }}
            t={t}
          />
        ))}
      </ScrollView>

      {showStats ? (
        <WordStats
          words={words}
          now={now}
          onPickBucket={(i) => setBucketFilter(i)}
          onPickLeeches={() => setLeechOnly(true)}
          t={t}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(w) => w._id}
          contentContainerStyle={{ paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const { text, due } = dueLabel(item, now);
            return (
              <Pressable
                style={[styles.row, { backgroundColor: t.card, borderBottomColor: t.border }]}
                onPress={() => setSheet({ mode: "edit", word: item })}
              >
                <View style={[styles.dot, { backgroundColor: BUCKETS[intervalBucket(item.srs.intervalDays)].color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 22, color: t.text }}>
                    {item.chinese}
                    {item.learn_writing ? " ✍️" : ""}
                    {isLeech(item) ? " 🐢" : ""}
                  </Text>
                  <Text style={{ color: t.subtext }} numberOfLines={1}>
                    {item.pinyin} — {item.def_english}
                  </Text>
                </View>
                <Text style={{ color: due ? t.danger : t.subtext, fontSize: 13 }}>{text}</Text>
              </Pressable>
            );
          }}
        />
      )}

      {sheet && (
        <WordSheet
          key={sheet.mode === "edit" ? sheet.word._id : "add"}
          word={sheet.mode === "edit" ? sheet.word : null}
          onClose={(changed) => {
            setSheet(null);
            if (changed) load();
          }}
          t={t}
        />
      )}
    </View>
  );
}

// The "all words, no search" view: how the collection is spread across the
// interval buckets. Every row is a shortcut into that bucket's filtered list.
function WordStats({
  words,
  now,
  onPickBucket,
  onPickLeeches,
  t,
}: {
  words: Word[];
  now: Date;
  onPickBucket: (bucket: number) => void;
  onPickLeeches: () => void;
  t: Theme;
}) {
  const counts = BUCKETS.map(() => 0);
  let dueCount = 0;
  let leechCount = 0;
  let writingCount = 0;
  for (const w of words) {
    counts[intervalBucket(w.srs.intervalDays)]++;
    if (isLeech(w)) leechCount++;
    else if (isDue(w.srs, now)) dueCount++;
    if (w.learn_writing) writingCount++;
  }

  // Bars are scaled against the biggest bucket, not the total — with a few
  // hundred new words everything else would otherwise be a sliver.
  const max = Math.max(1, ...counts);

  if (words.length === 0) {
    return (
      <View style={styles.statsEmpty}>
        <Text style={{ color: t.subtext, textAlign: "center" }}>
          No words yet — tap ＋ to add your first one.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.stats} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.text, fontSize: 15 }}>
        <Text style={{ fontWeight: "700" }}>{words.length}</Text> words ·{" "}
        <Text style={{ color: dueCount > 0 ? t.danger : t.subtext }}>{dueCount} due</Text> ·{" "}
        <Text style={{ color: t.subtext }}>{writingCount} ✍️</Text>
      </Text>

      {/* The whole collection as one bar — segment widths are the proportions. */}
      <View style={styles.spectrum}>
        {BUCKETS.map((b, i) =>
          counts[i] > 0 ? (
            <View key={i} style={[styles.spectrumPart, { flex: counts[i], backgroundColor: b.color }]} />
          ) : null,
        )}
      </View>

      <View style={{ gap: 6 }}>
        {BUCKETS.map((b, i) => (
          <StatRow
            key={i}
            label={b.label}
            color={b.color}
            count={counts[i]}
            fraction={counts[i] / max}
            onPress={() => onPickBucket(i)}
            t={t}
          />
        ))}
        {leechCount > 0 && (
          <StatRow
            label="🐢 leech"
            color="#ffe0e0"
            count={leechCount}
            fraction={leechCount / max}
            onPress={onPickLeeches}
            t={t}
          />
        )}
      </View>

      <Text style={{ color: t.subtext, fontSize: 12 }}>
        Tap a bar to list those words, or search above.
      </Text>
    </ScrollView>
  );
}

function StatRow({
  label,
  color,
  count,
  fraction,
  onPress,
  t,
}: {
  label: string;
  color: string;
  count: number;
  fraction: number;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable style={styles.statRow} onPress={onPress} disabled={count === 0}>
      <Text style={[styles.statLabel, { color: t.subtext }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.track, { backgroundColor: t.card }]}>
        {count > 0 && (
          <View style={[styles.bar, { width: `${Math.max(2, fraction * 100)}%`, backgroundColor: color }]} />
        )}
      </View>
      <Text style={[styles.statCount, { color: count > 0 ? t.text : t.subtext }]}>{count}</Text>
    </Pressable>
  );
}

function Chip({ label, color, active, onPress, t }: { label: string; color: string; active: boolean; onPress: () => void; t: Theme }) {
  return (
    <Pressable
      style={[styles.chip, { backgroundColor: color, borderColor: active ? t.tint : "transparent", borderWidth: 2 }]}
      onPress={onPress}
    >
      <Text style={{ fontSize: 12, color: "#333" }}>{label}</Text>
    </Pressable>
  );
}

function WordSheet({ word, onClose, t }: { word: Word | null; onClose: (changed: boolean) => void; t: Theme }) {
  const [chinese, setChinese] = useState(word?.chinese ?? "");
  const [pinyin, setPinyin] = useState(word?.pinyin ?? "");
  const [english, setEnglish] = useState(word?.def_english ?? "");
  const [comments, setComments] = useState(word?.comments ?? "");
  const [learnWriting, setLearnWriting] = useState(word?.learn_writing ?? false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);

  // Track the keyboard so a tap on the dim backdrop drops it first (and only
  // closes the sheet once the keyboard is already down).
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const backdropTap = () => {
    if (keyboardUp) Keyboard.dismiss();
    else onClose(false);
  };

  const save = async () => {
    const input: WordInput = {
      chinese: chinese.trim(),
      pinyin: pinyin.trim(),
      def_english: english.trim(),
      comments: comments.trim(),
      learn_writing: learnWriting,
    };
    try {
      if (word) await api.updateWord(word._id, input);
      else await api.createWord(input);
      onClose(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "This word is already in your dictionary."
          : "Could not save — is the server running?",
      );
    }
  };

  const resetProgress = async () => {
    if (!word) return;
    if (!(await confirm("Reset progress?", "The card goes back to due-now, all mastery cleared."))) return;
    await api.updateWord(word._id, { resetProgress: true });
    onClose(true);
  };

  const reactivate = async () => {
    if (!word) return;
    await api.updateWord(word._id, { unsuspend: true });
    onClose(true);
  };

  const remove = async () => {
    if (!word) return;
    if (!(await confirm("Delete word?", `${word.chinese} will be removed permanently.`))) return;
    await api.deleteWord(word._id);
    onClose(true);
  };

  const inputStyle = [styles.input, { backgroundColor: t.inputBg, color: t.text }];

  return (
    <Modal animationType="slide" transparent onRequestClose={() => onClose(false)}>
      <KeyboardAvoidingView
        style={styles.sheetBackdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Tapping anywhere outside the sheet dismisses the keyboard (then closes). */}
        <Pressable style={StyleSheet.absoluteFill} onPress={backdropTap} />
        <View style={[styles.sheet, { backgroundColor: t.bg }]}>
          <ScrollView
            contentContainerStyle={{ gap: 10, padding: 20 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={{ fontSize: 18, fontWeight: "700", color: t.text }}>
              {word ? "Edit word" : "New word"}
            </Text>
            <TextInput style={[inputStyle, { fontSize: 26 }]} value={chinese} onChangeText={setChinese} placeholder="中文" placeholderTextColor={t.subtext} />
            <TextInput style={inputStyle} value={pinyin} onChangeText={setPinyin} placeholder="pinyin (tone marks)" placeholderTextColor={t.subtext} autoCapitalize="none" />
            <TextInput style={inputStyle} value={english} onChangeText={setEnglish} placeholder="English meaning" placeholderTextColor={t.subtext} />
            <TextInput style={[inputStyle, { minHeight: 60 }]} value={comments} onChangeText={setComments} placeholder="example sentence / notes" placeholderTextColor={t.subtext} multiline />
            <View style={styles.switchRow}>
              <Text style={{ color: t.text }}>✍️ practice handwriting</Text>
              <Switch value={learnWriting} onValueChange={setLearnWriting} />
            </View>

            {word && (
              <View style={{ gap: 2 }}>
                <Text style={{ color: isLeech(word) ? t.danger : t.subtext, fontSize: 12 }}>
                  every {word.srs.intervalDays}d · ease {word.srs.ease} · {word.srs.lapses} lapses
                  {isLeech(word) ? " · 🐢 suspended" : ""}
                </Text>
                {/* Per-facet mastery — drives which question type the review asks. */}
                <Text style={{ color: t.subtext, fontSize: 12 }}>
                  {DIRECTIONS.map((d) => `${d} ${word.facets?.[d]?.strength ?? 0}`).join(" · ")}
                </Text>
              </View>
            )}

            {error && <Text style={{ color: t.danger }}>{error}</Text>}

            <Pressable
              style={[styles.primary, { backgroundColor: t.tint, opacity: chinese.trim() && pinyin.trim() && english.trim() ? 1 : 0.4 }]}
              onPress={save}
              disabled={!chinese.trim() || !pinyin.trim() || !english.trim()}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text>
            </Pressable>
            {word && isLeech(word) && (
              <Pressable style={[styles.secondary, { borderColor: t.tint }]} onPress={reactivate}>
                <Text style={{ color: t.tint }}>🐢 Reactivate leech</Text>
              </Pressable>
            )}
            {word && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[styles.secondary, { borderColor: t.border }]} onPress={resetProgress}>
                  <Text style={{ color: t.subtext }}>Reset progress</Text>
                </Pressable>
                <Pressable style={[styles.secondary, { borderColor: t.danger }]} onPress={remove}>
                  <Text style={{ color: t.danger }}>Delete</Text>
                </Pressable>
              </View>
            )}
            <Pressable style={{ alignItems: "center", padding: 8 }} onPress={() => onClose(false)}>
              <Text style={{ color: t.subtext }}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: 10, padding: 12, paddingBottom: 6 },
  search: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 16 },
  addButton: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chips: { gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  chip: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "#8884" },
  stats: { padding: 14, paddingTop: 6, gap: 14 },
  statsEmpty: { padding: 30 },
  spectrum: { flexDirection: "row", height: 10, gap: 2 },
  spectrumPart: { height: "100%", borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: "#8884" },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statLabel: { width: 54, fontSize: 12, textAlign: "right" },
  track: { flex: 1, height: 20, borderRadius: 4, overflow: "hidden" },
  bar: { height: "100%", borderRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: "#8884" },
  statCount: { width: 42, fontSize: 13, fontVariant: ["tabular-nums"] },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  primary: { borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  secondary: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center", borderWidth: 1 },
});
