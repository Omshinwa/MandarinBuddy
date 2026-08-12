import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { applyGrade, isScaffolded } from "../../../shared/src/srs";
import { DIRECTIONS } from "../../../shared/src/types";
import type { Grade, ReviewItem } from "../../../shared/src/types";
import { PrimaryButton } from "../components/Button";
import { MilestoneOverlay } from "../components/MilestoneOverlay";
import { FlashcardCard } from "../components/review/FlashcardCard";
import { InputCard } from "../components/review/InputCard";
import { ReviewChrome } from "../components/review/ReviewChrome";
import { facetView } from "../components/review/CardParts";
import { api } from "../lib/api";
import { directionBadge } from "../lib/labels";
import {
  leniencyMinLen,
  resolveMethod,
  useBothTransitionDays,
  useFuzzyPinyin,
  useInputLeniency,
  useReviewBatch,
  useScaffoldMaxDays,
  useTestMethods,
} from "../lib/settings";
import { useWindowKey } from "../lib/web";
import { useTheme, type Theme } from "../theme";

// What put the celebration on screen. `changingTo` is the badge of the question
// type the next card switches to, or null when the run just hit the batch size —
// the overlay says which, so the two aren't confused for one another.
type Milestone = { count: number; changingTo: string | null };

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
  const [fuzzy, setFuzzy] = useFuzzyPinyin();
  const [methods] = useTestMethods();
  const [scaffoldMaxDays] = useScaffoldMaxDays();
  const [bothTransitionDays] = useBothTransitionDays();
  const [leniency] = useInputLeniency();
  // Upper bound on how many same-type cards the server serves in a row, and the
  // number of cards a run has to reach for its own celebration (see `advance`).
  // A facet with fewer due cards yields a shorter run, which ends on a type
  // change instead of on this number.
  const [reviewBatch] = useReviewBatch();
  const [phase, setPhase] = useState<"loading" | "empty" | "active" | "done">("loading");
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0); // good answers (drives the streak color)
  const [milestone, setMilestone] = useState<Milestone | null>(null); // celebration to show, if any
  const runCount = useRef(0); // cards shown in the current run, reset by every celebration
  const [baseHue, setBaseHue] = useState(() => Math.floor(Math.random() * 360));
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reloads on any settings change that affects the queue: the batch size, and
  // the test methods (a facet switched to/from "None" changes what's served, and
  // any method change resets the session anyway). `methods` is a stable store
  // reference that only changes when a method is actually edited.
  const load = useCallback(() => {
    setPhase("loading");
    setSaveError(null);
    setIdx(0);
    setReviewed(0);
    setCorrect(0);
    setMilestone(null);
    runCount.current = 0;
    setBaseHue(Math.floor(Math.random() * 360));
    // Facets not set to "None" are the only ones the server should queue; if
    // every facet is None there's nothing to test, so skip the request.
    const directions = DIRECTIONS.filter((d) => methods[d] !== "none");
    if (directions.length === 0) {
      setQueue([]);
      setPhase("empty");
      return;
    }
    api
      .reviewQueue(reviewBatch, directions)
      .then((items) => {
        setQueue(items);
        setPhase(items.length ? "active" : "empty");
      })
      .catch(() => setPhase("empty"));
  }, [reviewBatch, methods]);

  useEffect(load, [load]);

  // Move past the current card. `requeue` sends it to the back of the session for
  // another try. The session ends when nothing follows; otherwise the celebration
  // goes up in place of the next card, on either of two triggers:
  //   - the question type changes — a meaning card and a reading card differ only
  //     by the badge, so an unannounced switch reads as a glitch. Read off the
  //     queue rather than counted, because a run is only *at most* `reviewBatch`
  //     long: a facet with fewer due cards than that ends its run early.
  //   - the current run reaches `reviewBatch` cards. Without this a session that
  //     never changes type (40 writing cards due and nothing else) has no
  //     boundary at all and would run to the end with no celebration.
  // Counting per run, not per session, is what keeps the two apart: a 12-card
  // reading run followed by a 15-card writing one celebrates the switch and then
  // starts the writing run from zero, instead of firing again three cards later
  // because the session total happened to hit the batch size.
  const advance = useCallback(
    (item: ReviewItem, requeue: boolean, count: number) => {
      runCount.current += 1; // every card shown counts — forgotten and taken-back ones included
      const next = requeue ? [...queue, item] : queue;
      if (idx + 1 >= next.length) {
        setPhase("done");
      } else if (count > 0) {
        const switchedTo = next[idx + 1].direction !== item.direction ? next[idx + 1].direction : null;
        if (switchedTo || runCount.current >= reviewBatch) {
          runCount.current = 0;
          setMilestone({ count, changingTo: switchedTo && directionBadge(switchedTo) });
        }
      }
      if (requeue) setQueue(next);
      setIdx((i) => i + 1);
    },
    [idx, queue, reviewBatch],
  );

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
      const nextReviewed = reviewed + 1;
      setReviewed(nextReviewed);
      // A "good" answer (anything but Forgot) still grows the streak color.
      if (g !== "reviewed_forgot") setCorrect((c) => c + 1);
      // Forgot → re-show this session, UNLESS this lapse just turned the card
      // into a leech (suspended) — then it leaves the session for good.
      const graded = applyGrade(item.word.srs, g, new Date());
      advance(item, g === "reviewed_forgot" && !graded.suspended, nextReviewed);
    },
    [advance, reviewed],
  );

  // "Actually I remember" on a given-up card: nothing is graded — the card keeps
  // its SRS state (still due) and just goes back to the end of this session's
  // queue for another try, so a mis-tap on Forgot doesn't cost a lapse. Nothing
  // was answered, so the celebration's count doesn't move.
  const requeueUngraded = useCallback(
    (item: ReviewItem) => {
      Haptics.selectionAsync().catch(() => {});
      advance(item, true, reviewed);
    },
    [advance, reviewed],
  );

  // A typed card in its answered state parks its "Continue" action here so the
  // user can commit it without aiming for the button — by tapping anywhere in
  // the card area, or (on web) pressing Enter. Null while there's nothing to
  // commit (still answering, or a meaning card).
  const continueRef = useRef<(() => void) | null>(null);
  const registerContinue = useCallback((fn: (() => void) | null) => {
    continueRef.current = fn;
  }, []);

  useWindowKey(
    "Enter",
    useCallback(() => continueRef.current?.(), []),
  );

  // A milestone takes over the whole screen until dismissed — shown in place of
  // the next card, so it interrupts the flow rather than layering over it.
  if (milestone !== null)
    return (
      <MilestoneOverlay
        count={milestone.count}
        changingTo={milestone.changingTo}
        onContinue={() => setMilestone(null)}
        t={t}
      />
    );

  const bg = streakBg(correct, baseHue, t);

  if (phase === "loading")
    return (
      <ReviewChrome bg={bg}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </ReviewChrome>
    );

  if (phase === "empty")
    return (
      <ReviewChrome bg={bg}>
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🌤</Text>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>
            Nothing due right now
          </Text>
          <Text style={{ color: t.subtext, textAlign: "center", paddingHorizontal: 40 }}>
            Add words from the Chat tab, or come back when reviews are due.
          </Text>
          <PrimaryButton label="Refresh" onPress={load} style={styles.retryButton} />
        </View>
      </ReviewChrome>
    );

  if (phase === "done")
    return (
      <ReviewChrome bg={bg}>
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🎉</Text>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "600" }}>
            Session complete — {reviewed} cards reviewed
          </Text>
          {correct > 0 && (
            <Text style={{ color: t.subtext, fontSize: 15 }}>{correct} answered correctly</Text>
          )}
          <PrimaryButton label="Check for more" onPress={load} style={styles.retryButton} />
        </View>
      </ReviewChrome>
    );

  const item = queue[idx];
  // Young cards get training wheels (pinyin, auto-played audio); mature cards
  // must be answered from the characters alone.
  const scaffold = isScaffolded(item.word.srs, scaffoldMaxDays);
  // A facet set to "both" resolves to flashcard or input based on how mature the
  // card is; plain flashcard/input pass through unchanged.
  const method = resolveMethod(methods[item.direction], item.word.srs.intervalDays, bothTransitionDays);
  const view = facetView(item.word, item.direction, scaffold, fuzzy, leniencyMinLen(leniency));
  // Fuzzy only bites on a typed reading test — hide the toggle otherwise.
  const showFuzzyToggle = item.direction === "reading" && method === "input";
  const Card = method === "flashcard" ? FlashcardCard : InputCard;
  return (
    <ReviewChrome
      bg={bg}
      meta={
        <View style={styles.metaRow}>
          <Text style={{ color: t.subtext }}>
            {Math.min(idx + 1, queue.length)} / {queue.length}
          </Text>
          <Text style={{ color: t.subtext }}>{directionBadge(item.direction)}</Text>
          {showFuzzyToggle ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ color: t.subtext, fontSize: 12 }}>fuzzy</Text>
              <Switch value={fuzzy} onValueChange={setFuzzy} />
            </View>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>
      }
    >
      <ScrollView
        contentContainerStyle={styles.cardArea}
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
        {/* Both card types take the same props; only the flashcard ignores the
            requeue/continue hooks it has no use for. */}
        <Card
          key={item.word._id + idx}
          view={view}
          word={item.word}
          direction={item.direction}
          srs={item.word.srs}
          scaffold={scaffold}
          onGrade={(g) => grade(item, g)}
          onRequeue={() => requeueUngraded(item)}
          registerContinue={registerContinue}
          t={t}
        />
      </ScrollView>
    </ReviewChrome>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  cardArea: { padding: 16, gap: 12, flexGrow: 1 },
  saveError: { color: "#fff", fontSize: 13, borderRadius: 10, padding: 10, overflow: "hidden" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  retryButton: { marginTop: 12 },
});
