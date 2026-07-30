import { useEffect } from "react";
import { Platform } from "react-native";

// Browser-only behaviour the app leans on, in one place. Everything here is a
// no-op (or a safe default) on the native builds, so callers never branch on
// Platform themselves.

// True only where there's a real keyboard attached. Enter is a deliberate
// keystroke on a laptop — worth binding to send/reveal — but on a phone the
// Return key is the only way to type a newline, so it must stay a newline.
// "hover + fine pointer" is the standard mouse-and-keyboard signal.
export const hasHardwareKeyboard =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

// Bind a hardware key (Enter, Escape, …) at the window level. Key events inside
// a TextInput don't bubble this far — react-native-web stops them — so this only
// fires for presses outside a field. `enabled` tears the listener down instead of
// swallowing the key, so nothing else is blocked while the binding is off.
export function useWindowKey(key: string, handler: () => void, enabled = true) {
  useEffect(() => {
    if (!hasHardwareKeyboard || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== key) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, handler, enabled]);
}
