import { useEffect, useState } from "react";
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

// Height of the area the browser is actually showing, or undefined on native.
//
// Mobile Safari doesn't shrink the page when the on-screen keyboard opens: it
// keeps the layout viewport at full height and scrolls the document up so the
// focused field is visible. A bottom-anchored app layout then hangs below the
// keyboard while its top (the review bar, and in a short thread the messages
// themselves) is pushed off screen — and there's nothing to scroll back to,
// because the app isn't scrollable. Sizing the app to visualViewport instead
// keeps the whole layout inside what's visible, keyboard up or down.
export function useVisualViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const vv =
      Platform.OS === "web" && typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const sync = () => {
      setHeight(vv.height);
      // Undo the scroll Safari did to reveal the field: once the app is sized to
      // the visible area there's nothing below to scroll to, and the offset
      // would only hide the top of the screen.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
  return height;
}
