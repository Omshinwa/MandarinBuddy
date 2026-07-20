import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DIRECTIONS, type Direction } from "../../../shared/src/types";
import { confirm } from "../lib/confirm";
import {
  DEFAULT_BOTH_TRANSITION_DAYS,
  DEFAULT_FUZZY_PINYIN,
  DEFAULT_INPUT_LENIENCY,
  DEFAULT_REVIEW_BATCH,
  DEFAULT_SCAFFOLD_MAX_DAYS,
  DEFAULT_TEST_METHODS,
  DEFAULT_THEME_PREF,
  DEFAULT_USER_LANGUAGE,
  INPUT_LENIENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  REVIEW_BATCH_OPTIONS,
  THEME_OPTIONS,
  type ThemePref,
  useBothTransitionDays,
  useFuzzyPinyin,
  useInputLeniency,
  useReviewBatch,
  useScaffoldMaxDays,
  useTestMethods,
  useThemePref,
  useUserLanguage,
} from "../lib/settings";
import { useTheme, type Theme } from "../theme";

// Global app settings. Opened from the Words tab (the gear next to +) rather
// than a tab of its own, since it's touched far less than the three main screens.
// Every knob here is persisted via the hooks in lib/settings.

const DIRECTION_LABEL: Record<Direction, string> = {
  meaning: "🧠 Meaning",
  reading: "🗣️ Reading",
  writing: "✍️ Writing",
};

const THEME_LABEL: Record<ThemePref, string> = {
  system: "🌗 System",
  light: "☀️ Light",
  dark: "🌙 Dark",
};

const SCAFFOLD_DAY_OPTIONS = [0, 3, 7, 14, 30, 45, 60];

export function SettingsScreen({ onClose }: { onClose?: () => void }) {
  const t = useTheme();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const [themePref, setThemePref] = useThemePref();
  const [language, setLanguage] = useUserLanguage();
  const [methods, setMethod] = useTestMethods();
  const [fuzzy, setFuzzy] = useFuzzyPinyin();
  const [scaffoldMaxDays, setScaffoldMaxDays] = useScaffoldMaxDays();
  const [bothTransitionDays, setBothTransitionDays] = useBothTransitionDays();
  const [leniency, setLeniency] = useInputLeniency();
  const [reviewBatch, setReviewBatch] = useReviewBatch();
  // "both" also produces typed input on mature cards, so leniency/fuzzy apply.
  const anyInput = DIRECTIONS.some((d) => methods[d] === "input" || methods[d] === "both");
  const anyBoth = DIRECTIONS.some((d) => methods[d] === "both");

  // Push every setter back to its default. We set values (rather than clearing
  // AsyncStorage) so every subscriber updates immediately — clearing storage
  // wouldn't touch the in-memory store the screens read from.
  const resetToDefaults = async () => {
    if (
      !(await confirm(
        "Reset to default?",
        "Every setting on this screen goes back to its default.",
      ))
    )
      return;
    setThemePref(DEFAULT_THEME_PREF);
    setLanguage(DEFAULT_USER_LANGUAGE);
    DIRECTIONS.forEach((d) => setMethod(d, DEFAULT_TEST_METHODS[d]));
    setFuzzy(DEFAULT_FUZZY_PINYIN);
    setScaffoldMaxDays(DEFAULT_SCAFFOLD_MAX_DAYS);
    setBothTransitionDays(DEFAULT_BOTH_TRANSITION_DAYS);
    setLeniency(DEFAULT_INPUT_LENIENCY);
    setReviewBatch(DEFAULT_REVIEW_BATCH);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]}>
      <View style={s.headerRow}>
        <Text style={s.title}>Settings</Text>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={s.done}>Done</Text>
          </Pressable>
        )}
      </View>

      <Section title="Appearance" t={t}>
        <View style={s.chips}>
          {THEME_OPTIONS.map((opt) => (
            <Chip
              key={opt}
              label={THEME_LABEL[opt]}
              active={themePref === opt}
              onPress={() => setThemePref(opt)}
              t={t}
            />
          ))}
        </View>
      </Section>

      <Section title="Your language" t={t}>
        <View style={s.chips}>
          {LANGUAGE_OPTIONS.map((opt) => (
            <Chip key={opt} label={opt} active={language === opt} onPress={() => setLanguage(opt)} t={t} />
          ))}
        </View>
      </Section>

      <Section title="Review test method" hint="FLASHCARD: shows the answer and you judge yourself. INPUT: you have to type part of the answer to pass. BOTH: flashcard while the card is young, then Input once it matures. NONE: this facet is never tested." t={t}>

        {DIRECTIONS.map((d) => (
          <View key={d} style={s.methodRow}>
            <Text style={s.label}>{DIRECTION_LABEL[d]}</Text>
            <Segmented
              value={methods[d]}
              options={[
                { value: "flashcard", label: "Flashcard" },
                { value: "input", label: "Input" },
                { value: "both", label: "Both" },
                { value: "none", label: "None" },
              ]}
              onChange={(m) => setMethod(d, m)}
              t={t}
            />
          </View>
        ))}
      </Section>

      {/* Only relevant once a facet is Both — this is the interval at which it
          flips from flashcard to typed input. */}
      {anyBoth && (
        <Section
          title="Both — switch to Input at"
          hint="A facet set to Both is a flashcard until the card's interval reaches this many days, then becomes a typed Input test."
          t={t}
        >
          <View style={s.chips}>
            {SCAFFOLD_DAY_OPTIONS.map((d) => (
              <Chip
                key={d}
                label={`${d}d`}
                active={bothTransitionDays === d}
                onPress={() => setBothTransitionDays(d)}
                t={t}
              />
            ))}
          </View>
        </Section>
      )}

      {/* Leniency only affects typed answers, so hide it when nothing is Input. */}
      {anyInput && (
        <Section
          title="Input test leniency"
          hint="How much of a typed answer must match. 1 = any matching part counts (most lenient); higher = that many characters required; Exact = the whole answer."
          t={t}
        >
          <View style={s.chips}>
            {INPUT_LENIENCY_OPTIONS.map((opt) => (
              <Chip
                key={String(opt)}
                label={opt === "exact" ? "Exact" : String(opt)}
                active={leniency === opt}
                onPress={() => setLeniency(opt)}
                t={t}
              />
            ))}
          </View>
          {/* Fuzzy only matters when reading is typed — tones are only checked on input. */}
          {(methods.reading === "input" || methods.reading === "both") && (
            <SwitchRow
              label="Fuzzy pinyin"
              hint="Accept the 2nd and 3rd tones interchangeably. Off = exact tones required."
              value={fuzzy}
              onValueChange={setFuzzy}
              t={t}
            />
          )}
        </Section>
      )}

      <Section
        title="Review scaffolding"
        hint="Cards younger than this interval are reviewed with training wheels — pinyin shown and audio auto-played."
        t={t}
      >
        <Text style={s.label}>Scaffold day time</Text>
        <View style={s.chips}>
          {SCAFFOLD_DAY_OPTIONS.map((d) => (
            <Chip
              key={d}
              label={`${d}d`}
              active={scaffoldMaxDays === d}
              onPress={() => setScaffoldMaxDays(d)}
              t={t}
            />
          ))}
        </View>
      </Section>

      <Section
        title="Review batch size"
        hint="How many cards are served in a row before switching exercise and getting a break."
        t={t}
      >
        <View style={s.chips}>
          {REVIEW_BATCH_OPTIONS.map((n) => (
            <Chip
              key={n}
              label={String(n)}
              active={reviewBatch === n}
              onPress={() => setReviewBatch(n)}
              t={t}
            />
          ))}
        </View>
      </Section>

      <Pressable onPress={resetToDefaults} style={s.resetButton}>
        <Text style={s.resetText}>Reset to default</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({
  title,
  hint,
  children,
  t,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  t: Theme;
}) {
  const s = styles(t);
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {hint && <Text style={s.sectionHint}>{hint}</Text>}
      <View style={s.card}>{children}</View>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  t,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles(t).chip,
        { borderColor: active ? t.tint : t.border, backgroundColor: active ? t.tint : "transparent" },
      ]}
    >
      <Text style={{ color: active ? "#fff" : t.text, fontWeight: active ? "700" : "500" }}>{label}</Text>
    </Pressable>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  t,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  t: Theme;
}) {
  const s = styles(t);
  return (
    <View style={s.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[s.segment, active && { backgroundColor: t.tint }]}
          >
            <Text style={{ color: active ? "#fff" : t.subtext, fontWeight: "600", fontSize: 13 }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onValueChange,
  t,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  t: Theme;
}) {
  const s = styles(t);
  return (
    <View>
      <View style={s.row}>
        <Text style={s.label}>{label}</Text>
        <Switch value={value} onValueChange={onValueChange} />
      </View>
      {hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    content: { padding: 20, gap: 24, paddingBottom: 48 },
    headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    title: { fontSize: 30, fontWeight: "800", color: t.text },
    done: { fontSize: 17, fontWeight: "700", color: t.tint },
    section: { gap: 8 },
    sectionTitle: { fontSize: 15, fontWeight: "700", color: t.subtext, textTransform: "uppercase", letterSpacing: 0.5 },
    sectionHint: { fontSize: 13, color: t.subtext, marginTop: -2 },
    card: {
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 14,
      padding: 16,
      gap: 14,
    },
    row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    label: { fontSize: 16, color: t.text },
    hint: { fontSize: 12.5, color: t.subtext, marginTop: 4 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1.5 },
    methodRow: { gap: 8 },
    segmented: {
      flexDirection: "row",
      backgroundColor: t.inputBg,
      borderRadius: 10,
      padding: 2,
      alignSelf: "stretch",
    },
    segment: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
    resetButton: {
      alignSelf: "center",
      marginTop: 4,
      paddingVertical: 12,
      paddingHorizontal: 22,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: t.danger,
    },
    resetText: { color: t.danger, fontWeight: "700", fontSize: 15 },
  });
