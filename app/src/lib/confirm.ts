import { Alert, Platform } from "react-native";

// Alert.alert has no buttons on react-native-web — use window.confirm there.
export function confirm(title: string, message?: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", style: "destructive", onPress: () => resolve(true) },
    ]),
  );
}
