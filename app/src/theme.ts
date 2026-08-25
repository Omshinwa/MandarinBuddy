import { useColorScheme } from "react-native";
import { useThemePref } from "./lib/settings";

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  text: string;
  subtext: string;
  border: string;
  tint: string;
  danger: string;
  warning: string;
  success: string;
  inputBg: string;
  highlight: string;
}

const light: Theme = {
  dark: false,
  bg: "#f6f6f8",
  card: "#ffffff",
  text: "#1a1a1e",
  subtext: "#6b6b76",
  border: "#e3e3ea",
  tint: "#4f6ef7",
  danger: "#d64545",
  warning: "#d97e28",
  success: "#2f9e63",
  inputBg: "#efeff4",
  highlight: "#fff3c4",
};

const dark: Theme = {
  dark: true,
  bg: "#0f0f13",
  card: "#1b1b21",
  text: "#f2f2f5",
  subtext: "#9a9aa5",
  border: "#2c2c34",
  tint: "#7c93ff",
  danger: "#ff6b6b",
  warning: "#ffa94d",
  success: "#4ecb8d",
  inputBg: "#26262e",
  highlight: "#4a3f1d",
};

export function useTheme(): Theme {
  const system = useColorScheme();
  const [pref] = useThemePref();
  // "system" tracks the OS/browser; light/dark force it regardless.
  const isDark = pref === "system" ? system === "dark" : pref === "dark";
  return isDark ? dark : light;
}
