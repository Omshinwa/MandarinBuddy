import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsScreen } from "../../screens/SettingsScreen";

// The frame every phase renders inside: the streak-tinted background and a top
// bar whose right end is the Settings gear. `meta` fills the rest of that bar
// (the card counter and facet badge, when a card is up). Settings sit here
// because everything in them tunes reviewing — and they stay reachable from the
// empty and done screens, which is exactly where you'd go to change the batch.
export function ReviewChrome({
  bg,
  meta,
  children,
}: {
  bg: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>{meta}</View>
        <Pressable
          style={styles.gearButton}
          hitSlop={10}
          onPress={() => setSettingsOpen(true)}
          accessibilityLabel="Settings"
        >
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>
      {children}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SettingsScreen onClose={() => setSettingsOpen(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  gearButton: { padding: 4 },
});
