import { router } from "expo-router";
import { useRef } from "react";
import { backOrReplace } from "@/navigation";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useNotices } from "@/data/queries";
import { OfflineBooksStatus } from "@/offline/OfflineBooksStatus";

import { colors, space } from "@/theme";
import { IconButton } from "./Button";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Start loading the next page this far (px) before the end of the list. */
const END_DISTANCE = 900;

/**
 * Page wrapper: safe area, white background, scrolling content with 16px gutters
 * and an optional fixed footer (e.g. a Save button bar).
 */
export function Screen({
  header,
  children,
  footer,
  scroll = true,
  onRefresh,
  refreshing = false,
  contentStyle,
  onEndReached,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /**
   * Paged lists: called when the user scrolls near the bottom, or when the
   * content is shorter than the screen. It may be called repeatedly; the
   * caller ignores it while a page is loading or when there is no more.
   */
  onEndReached?: () => void;
}) {
  const viewport = useRef(0);
  const nearEnd = (contentHeight: number, offset: number) =>
    contentHeight - (offset + viewport.current) < END_DISTANCE;
  return (
    <SafeAreaView edges={["top"]} style={styles.page}>
      {header}
      <OfflineBooksStatus />
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => {
            viewport.current = e.nativeEvent.layout.height;
          }}
          onScroll={
            onEndReached
              ? ({ nativeEvent: e }) => {
                  if (nearEnd(e.contentSize.height, e.contentOffset.y))
                    onEndReached();
                }
              : undefined
          }
          scrollEventThrottle={onEndReached ? 100 : undefined}
          onContentSizeChange={
            onEndReached
              ? (_width, height) => {
                  if (viewport.current && nearEnd(height, 0)) onEndReached();
                }
              : undefined
          }
          contentContainerStyle={[styles.content, contentStyle]}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, contentStyle]}>
          {children}
        </View>
      )}
      {footer}
    </SafeAreaView>
  );
}

/** Header for pushed screens: back/close button, title, subtitle and actions on the right. */
export function Header({
  title,
  subtitle,
  right,
  close,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Show an X instead of a back arrow (for create forms). */
  close?: boolean;
}) {
  return (
    <View style={styles.header}>
      <IconButton
        icon={close ? "x" : "chevron-left"}
        label={close ? "Close" : "Back"}
        onPress={() => backOrReplace(router)}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="heading" numberOfLines={1} style={{ fontSize: 17 }}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" tone="body" numberOfLines={1}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {right}
    </View>
  );
}

/** Large title used on tab screens ("Parties", "Items", "More"). */
export function TabTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <View
      style={[styles.header, { borderBottomWidth: 0, paddingLeft: space.lg }]}
    >
      <Txt variant="title" style={{ flex: 1, fontSize: 24 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

/** Fixed bar at the bottom of a form (respects the phone's home indicator). */
export function FooterBar({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        { paddingBottom: Math.max(insets.bottom, space.lg) },
      ]}
    >
      {children}
    </View>
  );
}

/** Home top bar: firm name and financial year on the left, search and notifications on the right. */
export function FirmBar({
  firmName,
  fyLabel,
  city,
  onPressFirm,
}: {
  firmName: string;
  fyLabel: string;
  city: string;
  onPressFirm?: () => void;
}) {
  const notices = useNotices();
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch firm or financial year"
        onPress={onPressFirm}
        style={{
          flex: 1,
          paddingLeft: space.sm,
          minHeight: 44,
          justifyContent: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Txt variant="heading" style={{ fontSize: 17 }} numberOfLines={1}>
            {firmName}
          </Txt>
          <Icon name="chevron-down" size={16} />
        </View>
        <Txt variant="caption" tone="body">
          FY {fyLabel} · {city}
        </Txt>
      </Pressable>
      <IconButton
        icon="search"
        label={"Search"}
        onPress={() => router.push("/search")}
      />
      <IconButton
        icon="bell"
        label={"Notifications"}
        badge={(notices.data?.unread ?? 0) > 0}
        onPress={() => router.push("/notifications")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl * 3, gap: space.xl },
  header: {
    minHeight: 60,
    paddingHorizontal: space.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.canvas,
  },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    backgroundColor: colors.canvas,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
});
