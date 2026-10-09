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
import {
  type Facet,
  FACETS,
  isDue,
  isFacetUnlocked,
  normalizeText,
  TUNING,
  type Word,
  type WordInput,
} from "../../../shared/src";
import { BUCKETS, intervalBucket } from "../lib/buckets";
import { FACET_LABEL, facetEmoji } from "../lib/labels";
import { useTestMethods } from "../lib/settings";
import { OutlineButton, PrimaryButton } from "../components/Button";
import { TextStyling } from "../components/TextStyling";
import { ApiError, api } from "../lib/api";
import { confirm } from "../lib/confirm";
import { useTheme, type Theme } from "../theme";

const DAY_MS = 24 * 60 * 60 * 1000;

// A word is a leech when any of its facets got suspended after too many lapses.
function isLeech(w: Word): boolean {
  return FACETS.some((d) => w.facets[d].suspended === true);
}

// The facets you're actually tested on: not set to None, and unlocked.
function activeFacets(w: Word, enabled: readonly Facet[]): Facet[] {
  return enabled.filter((d) => isFacetUnlocked(w, d, enabled.includes("meaning")));
}

// A word is only as known as its weakest active facet.
function wordInterval(w: Word, enabled: readonly Facet[]): number {
  const active = activeFacets(w, enabled);
  return active.length ? Math.min(...active.map((d) => w.facets[d].intervalDays)) : 0;
}

function dueLabel(w: Word, enabled: readonly Facet[], now: Date): { text: string; due: boolean } {
  // Leeches aren't asked, so they neither come due nor set the countdown.
  const facets = activeFacets(w, enabled).filter((d) => !w.facets[d].suspended);
  if (facets.length === 0) return { text: isLeech(w) ? "leech" : "", due: false };
  // Each facet has its own schedule, so name every one that's due by its emoji.
  const dueNow = facets.filter((d) => isDue(w.facets[d], now));
  if (dueNow.length) return { text: `due ${dueNow.map(facetEmoji).join("")}`, due: true };
  // Otherwise the word comes due with its earliest facet.
  const next = Math.min(...facets.map((d) => Date.parse(w.facets[d].due)));
  const days = (next - now.getTime()) / DAY_MS;
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
  const [methods] = useTestMethods();
  const enabled = useMemo(() => FACETS.filter((d) => methods[d] !== "none"), [methods]);

  const load = useCallback(() => {
    api.listWords().then(setWords).catch(() => {});
  }, []);

  useFocusEffect(load);

  const now = new Date();
  const filtered = useMemo(() => {
    // Search folds both sides like a typed answer, minus the tones: "ai" finds "ài".
    const normalize_search = (s: string) => normalizeText(s, false, true);
    const q = normalize_search(search.trim());
    return words.filter((w) => {
      if (leechOnly && !isLeech(w)) return false;
      if (bucketFilter !== null && intervalBucket(wordInterval(w, enabled)) !== bucketFilter)
        return false;
      if (!q) return true;
      return (
        normalize_search(w.chinese).includes(q) ||
        normalize_search(w.pinyin).includes(q) ||
        normalize_search(w.english).includes(q)
        // || normalize_search(w.comments).includes(q)
      );
    });
  }, [words, search, bucketFilter, leechOnly, enabled]);

  // The distribution lives under the chips as a bar per chip, so the graph is
  // the filter bar rather than a second copy of it.
  const counts = BUCKETS.map(() => 0);
  let leechCount = 0;
  for (const w of words) {
    counts[intervalBucket(wordInterval(w, enabled))]++;
    if (isLeech(w)) leechCount++;
  }
  // Bars are scaled against the biggest bucket, not the total — with a few
  // hundred new words everything else would otherwise be a sliver.
  const max = Math.max(1, ...counts);

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
          count={words.length}
          // "all" is every bucket at once, so its bar is the whole spectrum
          // stacked — full height, segments in proportion.
          segments={counts}
          t={t}
          onPress={() => {
            setBucketFilter(null);
            setLeechOnly(false);
          }}
        />
        {leechCount > 0 && (
          <Chip
            label="🐢"
            color="#ffe0e0"
            active={leechOnly}
            count={leechCount}
            fraction={leechCount / max}
            t={t}
            onPress={() => {
              setLeechOnly((v) => !v);
              setBucketFilter(null);
            }}
          />
        )}
        {BUCKETS.map((b, i) => (
          <Chip
            key={i}
            label={b.label}
            color={b.color}
            active={bucketFilter === i && !leechOnly}
            count={counts[i]}
            fraction={counts[i] / max}
            t={t}
            onPress={() => {
              setLeechOnly(false);
              setBucketFilter(bucketFilter === i ? null : i);
            }}
          />
        ))}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(w) => w._id}
        contentContainerStyle={{ paddingBottom: 30 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          <Text style={{ color: t.subtext, textAlign: "center", padding: 30 }}>
            {words.length === 0 ? "No words yet — tap ＋ to add your first one." : "Nothing here."}
          </Text>
        }
        renderItem={({ item }) => {
          const { text, due } = dueLabel(item, enabled, now);
          return (
            <Pressable
              style={[styles.row, { backgroundColor: t.card, borderBottomColor: t.border }]}
              onPress={() => setSheet({ mode: "edit", word: item })}
            >
              <View style={[styles.dot, { backgroundColor: BUCKETS[intervalBucket(wordInterval(item, enabled))].color }]} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 22, color: t.text }}>
                  <TextStyling text={item.chinese} />
                  {item.learn_writing ? " ✍️" : ""}
                  {isLeech(item) ? " 🐢" : ""}
                </Text>
                <TextStyling
                  text={`${item.pinyin} — ${item.english}`}
                  style={{ color: t.subtext }}
                  numberOfLines={1}
                />
              </View>
              <Text style={{ color: due ? t.danger : t.subtext, fontSize: 13 }}>{text}</Text>
            </Pressable>
          );
        }}
      />

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

// A filter chip with its slice of the distribution growing underneath it: the
// graph and the filter bar are the same control, so neither is a duplicate of
// the other. `segments` (the "all" chip) stacks every bucket at full height
// instead of scaling one bar.
function Chip({
  label,
  color,
  active,
  count,
  fraction,
  segments,
  onPress,
  t,
}: {
  label: string;
  color: string;
  active: boolean;
  count: number;
  fraction?: number;
  segments?: number[];
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable style={styles.chipCol} onPress={onPress}>
      <View style={[styles.chip, { backgroundColor: color, borderColor: active ? t.tint : "transparent" }]}>
        <Text style={{ fontSize: 12, color: "#333" }}>{label}</Text>
      </View>
      {/* Outlined in the same tint as the chip when active — the bar is part of
          the same button, not decoration sitting next to it. */}
      <View style={[styles.vTrack, { backgroundColor: t.card, borderColor: active ? t.tint : t.border }]}>
        {segments
          ? segments.map((n, i) =>
              n > 0 ? <View key={i} style={{ flex: n, backgroundColor: BUCKETS[i].color }} /> : null,
            )
          : count > 0 && (
              // Floor the height so a bucket holding one word still reads as
              // present rather than as an empty track.
              <View style={{ height: `${Math.max(4, (fraction ?? 0) * 100)}%`, backgroundColor: color }} />
            )}
      </View>
      <Text style={[styles.vCount, { color: count > 0 ? t.text : t.subtext }]}>{count}</Text>
    </Pressable>
  );
}

// One schedule per facet, as a table without borders: fixed-width columns keep
// the numbers lined up whatever the label's width.
function FacetTable({ word, enabled, t }: { word: Word; enabled: readonly Facet[]; t: Theme }) {
  const now = new Date();
  return (
    <View style={{ gap: 2 }}>
      <View style={styles.facetRow}>
        <View style={styles.facetLabel} />
        {["interval", "ease", "lapses"].map((h) => (
          <Text key={h} style={[styles.facetCell, { color: t.subtext, fontSize: 11 }]}>
            {h}
          </Text>
        ))}
      </View>
      {FACETS.map((d) => {
        const s = word.facets[d];
        const color = s.suspended ? t.danger : t.subtext;
        // Same rule as the list's "due": a facet set to None or suspended as a
        // leech is never asked, so it isn't flagged.
        const due = enabled.includes(d) && !s.suspended && isDue(s, now);
        return (
          <View key={d} style={styles.facetRow}>
            <Text style={[styles.facetLabel, { color }]}>{FACET_LABEL[d]}</Text>
            {isFacetUnlocked(word, d, enabled.includes("meaning")) ? (
              <>
                <Text style={[styles.facetCell, { color }]}>{s.intervalDays}d</Text>
                <Text style={[styles.facetCell, { color }]}>{s.ease}</Text>
                <Text style={[styles.facetCell, { color }]}>{s.lapses}</Text>
                {s.suspended && <Text style={{ color, fontSize: 12 }}>🐢 suspended</Text>}
                {due && <Text style={{ color: t.danger, fontSize: 12 }}>due</Text>}
              </>
            ) : (
              <Text style={{ color, fontSize: 12 }}>🔒 unlocks when meaning reaches {TUNING.unlockAfterDays}d</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

function WordSheet({ word, onClose, t }: { word: Word | null; onClose: (changed: boolean) => void; t: Theme }) {
  const [methods] = useTestMethods();
  const enabled = FACETS.filter((d) => methods[d] !== "none");
  const [chinese, setChinese] = useState(word?.chinese ?? "");
  const [pinyin, setPinyin] = useState(word?.pinyin ?? "");
  const [english, setEnglish] = useState(word?.english ?? "");
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
      english: english.trim(),
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

            {/* One schedule per facet — the lapse counts show which one you forget most. */}
            {word && <FacetTable word={word} enabled={enabled} t={t} />}

            {error && <Text style={{ color: t.danger }}>{error}</Text>}

            <PrimaryButton
              label="Save"
              onPress={save}
              disabled={!chinese.trim() || !pinyin.trim() || !english.trim()}
            />
            {word && isLeech(word) && (
              <OutlineButton label="🐢 Reactivate leech" onPress={reactivate} />
            )}
            {word && (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <OutlineButton
                  label="Reset progress"
                  onPress={resetProgress}
                  color={t.subtext}
                  borderColor={t.border}
                  style={{ flex: 1 }}
                />
                <OutlineButton label="Delete" onPress={remove} color={t.danger} style={{ flex: 1 }} />
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
  chips: { gap: 6, paddingHorizontal: 12, paddingBottom: 8, alignItems: "flex-start" },
  chipCol: { alignItems: "stretch", gap: 3 },
  // Fixed height, not padding: an emoji label is taller than a text one, and
  // uneven chips would leave the bars below them out of line with each other.
  chip: {
    height: 26,
    borderRadius: 14,
    paddingHorizontal: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  // Bars grow upward from the bottom of the track, so column-reverse also puts
  // the shortest-interval bucket at the base of the stacked "all" bar.
  // Border width matches the chip's and never changes, so selecting a chip
  // recolors the outline without resizing the bar inside it.
  vTrack: { height: 46, borderRadius: 4, overflow: "hidden", flexDirection: "column-reverse", borderWidth: 2 },
  vCount: { fontSize: 11, textAlign: "center", fontVariant: ["tabular-nums"] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "#8884" },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0008" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  facetRow: { flexDirection: "row", alignItems: "baseline" },
  facetLabel: { width: 96, fontSize: 12 },
  facetCell: { width: 64, fontSize: 12, fontVariant: ["tabular-nums"] },
});
