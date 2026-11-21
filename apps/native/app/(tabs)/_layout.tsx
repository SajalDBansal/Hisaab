import { router, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, Txt, type IconName } from "@/components";

import { colors, radius } from "@/theme";

/** The five bottom tabs. The middle "+" opens the Create sheet instead of a page. */
const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: "index", label: "Home", icon: "home" },
  { name: "parties", label: "Parties", icon: "users" },
  { name: "create", label: "Create", icon: "plus" },
  { name: "items", label: "Items", icon: "package" },
  { name: "more", label: "More", icon: "grid" },
];

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}

type TabBarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];

/** The tab bar navigates by path: the bar's own navigation prop is not always passed. */
const tabHref = (name: string) => (name === "index" ? "/" : `/${name}`) as "/";

function TabBar({ state }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, i) => {
        const tab = TABS.find((t) => t.name === route.name);
        if (!tab) return null;
        const focused = state.index === i;

        if (tab.name === "create") {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel="Create"
              onPress={() => router.push("/create-sheet")}
              style={styles.tab}
            >
              <View style={styles.plus}>
                <Icon name="plus" size={24} color={colors.onPrimary} />
              </View>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            onPress={() => router.navigate(tabHref(route.name))}
            style={styles.tab}
          >
            <Icon
              name={tab.icon}
              size={22}
              color={focused ? colors.ink : colors.body}
            />
            <Txt
              variant="caption"
              tone={focused ? "ink" : "body"}
              style={{ fontSize: 11, fontWeight: focused ? "600" : "500" }}
            >
              {tab.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    paddingTop: 6,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  plus: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
