import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { API_BASE } from "../lib/api";
import { useAppPassword } from "../lib/settings";
import { useTheme } from "../theme";

// Check a typed password against the server before we trust it. POST /api/auth/check
// is guarded by the same middleware as every write, so a 200 means this password
// will actually work; a 401 means it's wrong. (If the server has no APP_PASSWORD
// set — e.g. local dev — the gate is disabled there and any password verifies OK.)
async function verify(pw: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/check`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": pw },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Wraps the app in a shared-password gate. Until a valid password is stored, the
// login form shows instead of the app. The password is verified against the
// server before it's saved, so a wrong one never gets past this screen — and the
// server rechecks it on every write regardless, so this is convenience, not the
// actual lock.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useAppPassword();
  const t = useTheme();
  const [entry, setEntry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (password) return <>{children}</>;

  const submit = async () => {
    if (!entry || busy) return;
    setBusy(true);
    setError(null);
    const ok = await verify(entry);
    setBusy(false);
    if (ok) setPassword(entry);
    else setError("Wrong password");
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: "600", color: t.text, marginBottom: 4 }}>
        SuperAnki
      </Text>
      <Text style={{ color: t.subtext, marginBottom: 20 }}>Enter the password to continue</Text>
      <TextInput
        value={entry}
        onChangeText={(v) => {
          setEntry(v);
          setError(null);
        }}
        onSubmitEditing={submit}
        placeholder="Password"
        placeholderTextColor={t.subtext}
        secureTextEntry
        autoFocus
        style={{
          width: "100%",
          maxWidth: 320,
          borderWidth: 1,
          borderColor: error ? t.danger : t.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: t.text,
          backgroundColor: t.inputBg,
          fontSize: 16,
        }}
      />
      {error ? <Text style={{ color: t.danger, marginTop: 8 }}>{error}</Text> : null}
      <Pressable
        onPress={submit}
        disabled={busy || !entry}
        style={{
          marginTop: 16,
          width: "100%",
          maxWidth: 320,
          backgroundColor: t.tint,
          borderRadius: 10,
          paddingVertical: 13,
          alignItems: "center",
          opacity: busy || !entry ? 0.6 : 1,
        }}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>Unlock</Text>
        )}
      </Pressable>
    </View>
  );
}
