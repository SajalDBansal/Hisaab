import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { NoticeKind, NoticeLink, NoticeRow } from "@repo/core";
import {
  Button,
  EmptyState,
  Header,
  Icon,
  QueryView,
  Screen,
  Txt,
  type IconName,
} from "@/components";
import { useMarkNoticesRead, useNotices } from "@/data/queries";

import { colors, radius, space } from "@/theme";

const ICON: Record<NoticeKind, IconName> = {
  overdue: "alert-circle",
  payable: "arrow-up-right",
  reminders: "message-circle",
  "low-stock": "package",
  estimate: "clipboard",
  gst: "percent",
  backup: "cloud",
};

const hrefFor = (link: NoticeLink): Href => {
  switch (link.screen) {
    case "party":
      return `/party/${link.id}`;
    case "item":
      return `/item/${link.id}`;
    case "voucher":
      return `/voucher/${link.id}`;
    case "reminders":
      return "/settings/reminders";
    case "gst":
      return "/gst";
    case "backup":
      return "/settings/backup";
    case "outstanding":
      return { pathname: "/reports/outstanding", params: { type: "customer" } };
  }
};

/**
 * The bell: what needs attention today — overdue customers, bills to pay,
 * reminders to send, GST filing dates, low stock, expiring estimates, backup.
 */
export default function NotificationsScreen() {
  const notices = useNotices();
  const markRead = useMarkNoticesRead();
  const unread = notices.data?.notices.filter((n) => !n.read) ?? [];

  const open = (n: NoticeRow) => {
    if (!n.read) markRead.mutate([n.id]);
    router.push(hrefFor(n.link));
  };

  return (
    <Screen
      header={
        <Header
          title={"Notifications"}
          subtitle={
            notices.data
              ? unread.length > 0
                ? `${unread.length} new`
                : "All caught up"
              : undefined
          }
          right={
            unread.length > 0 ? (
              <Button
                label="Mark all read"
                size="sm"
                loading={markRead.isPending}
                onPress={() => markRead.mutate(unread.map((n) => n.id))}
              />
            ) : null
          }
        />
      }
      onRefresh={() => notices.refetch()}
      refreshing={notices.isRefetching}
    >
      <QueryView query={notices}>
        {({ notices: list }) =>
          list.length === 0 ? (
            <EmptyState
              icon="bell"
              title="Nothing needs your attention"
              message="Overdue bills, GST dates, low stock and reminders show up here."
            />
          ) : (
            <View style={{ gap: space.sm }}>
              {list.map((n) => (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.read ? "" : "New: "}${n.title}`}
                  onPress={() => open(n)}
                  style={({ pressed }) => [
                    styles.row,
                    !n.read && styles.unread,
                    pressed && { backgroundColor: colors.surfaceSoft },
                  ]}
                >
                  <View
                    style={[
                      styles.icon,
                      n.tone === "give" && { backgroundColor: colors.badBg },
                      n.tone === "warn" && { backgroundColor: colors.warnBg },
                    ]}
                  >
                    <Icon
                      name={ICON[n.kind]}
                      size={18}
                      color={colors[n.tone]}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt
                      variant="bodyStrong"
                      style={{ fontWeight: n.read ? "400" : "600" }}
                    >
                      {n.title}
                    </Txt>
                    <Txt variant="small" tone="body">
                      {n.body}
                    </Txt>
                  </View>
                  {!n.read ? <View style={styles.dot} /> : null}
                </Pressable>
              ))}
            </View>
          )
        }
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  unread: { borderColor: colors.hairlineStrong },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ink,
    marginTop: 6,
  },
});
