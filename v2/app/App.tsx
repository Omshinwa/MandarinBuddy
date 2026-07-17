import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { WordsScreen } from "./src/screens/WordsScreen";
import { useTheme } from "./src/theme";

const Tab = createBottomTabNavigator();

const icon = (emoji: string) =>
  function TabIcon({ size }: { focused: boolean; color: string; size: number }) {
    return <Text style={{ fontSize: size - 2 }}>{emoji}</Text>;
  };

export default function App() {
  const t = useTheme();

  // t.dark already folds in the user's light/dark override, so drive the nav
  // chrome and status bar from it rather than the raw OS scheme.
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: t.tint,
      background: t.bg,
      card: t.card,
      text: t.text,
      border: t.border,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar style={t.dark ? "light" : "dark"} />
        <Tab.Navigator
          screenOptions={{
            tabBarActiveTintColor: t.tint,
            tabBarInactiveTintColor: t.subtext,
          }}
        >
          <Tab.Screen
            name="Chat"
            component={ChatScreen}
            options={{ tabBarIcon: icon("💬"), title: "Chat", headerShown: false }}
          />
          <Tab.Screen
            name="Review"
            component={ReviewScreen}
            options={{ tabBarIcon: icon("🎴"), title: "Review", headerShown: false }}
          />
          <Tab.Screen
            name="Words"
            component={WordsScreen}
            options={{ tabBarIcon: icon("📚"), title: "Words", headerShown: false }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
