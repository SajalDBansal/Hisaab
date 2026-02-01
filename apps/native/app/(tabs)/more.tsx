import { useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { resetDb, roleInfo } from "@repo/core";
import {
  Avatar,
  Icon,
  ListRow,
  Screen,
  TabTitle,
  Txt,
  type IconName,
} from "@/components";
import { APP_NAME } from "@/data/labels";
import { useData } from "@/data/DataProvider";
import { confirmAction } from "@/data/confirm";
import { useFirm, useTeam } from "@/data/queries";

import { colors, radius, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

/** All modules that don't fit in the bottom tabs. */
const MODULES: { title: string; note: string; icon: IconName; href: Href }[] = [
  {
    title: "Sales",
    note: "Quotations, orders, invoices",
    icon: "file-text",
    href: "/sales",
  },
  {
    title: "Purchase",
    note: "Purchase bills",
    icon: "shopping-cart",
    href: "/purchases",
  },
  {
    title: "Estimates & orders",
    note: "Quotes, orders, challans, POs",
    icon: "clipboard",
    href: "/orders",
  },
  {
    title: "Inventory",
    note: "Godowns, movements, valuation",
    icon: "package",
    href: "/items",
  },
  {
    title: "Banking",
    note: "Cash, banks, cheques",
    icon: "credit-card",
    href: "/banking",
  },
  {
    title: "Accounting",
    note: "Accounts, journals, ledgers",
    icon: "book",
    href: "/accounts",
  },
  {
    title: "GST",
    note: "GST returns and tax summary",
    icon: "percent",
    href: "/gst",
  },
  {
    title: "Documents",
    note: "Bills, receipts, firm papers",
    icon: "folder",
    href: "/documents",
  },
  {
    title: "Reports",
    note: "Books, parties, stock, tax",
    icon: "bar-chart-2",
    href: "/reports",
  },
  {
    title: "Settings",
    note: "Firm, team, roles, numbering",
    icon: "sliders",
    href: "/settings",
  },
];

export default function MoreScreen() {
  const { userId } = useData();
  const demo = userId === "demo";
  const gst = useGstMode();
  // GST switched off for this firm: no GST tile
  const modules = MODULES.filter((m) => m.href !== "/gst" || gst.on);
  const firm = useFirm();
  const team = useTeam();
  const me = team.data?.members.find((m) => m.id === team.data?.currentUserId);
  const queryClient = useQueryClient();

  const resetDemo = () =>
    demo &&
    confirmAction(
      "Reset demo data?",
      "All entries you added in this session will be removed.",
      "Reset",
      () => {
        resetDb();
        queryClient.invalidateQueries();
      },
    );

  return (
    <Screen
      header={<TabTitle title={"More"} />}
      contentStyle={{ gap: space.xl, paddingTop: space.xs }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/settings")}
        style={styles.profile}
      >
        <Avatar name={me?.name ?? ""} size={48} />
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{me?.name ?? " "}</Txt>
          <Txt variant="small" tone="body">
            {me ? roleInfo(me.role).label : ""} · {firm.data?.name ?? ""}
          </Txt>
        </View>
        <Icon name="settings" size={18} color={colors.body} />
      </Pressable>

      <View style={styles.grid}>
        {modules.map((m) => (
          <Pressable
            key={m.title}
            accessibilityRole="button"
            onPress={() => router.push(m.href)}
            style={({ pressed }) => [
              styles.tile,
              pressed && { backgroundColor: colors.surfaceSoft },
            ]}
          >
            <Icon name={m.icon} size={22} />
            <Txt variant="bodyStrong" style={{ fontWeight: "600" }}>
              {m.title}
            </Txt>
            <Txt variant="caption" tone="body">
              {m.href === "/gst" && gst.composition
                ? "Composition tax by quarter"
                : m.note}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          {"Shortcuts"}
        </Txt>
        <ListRow
          left={<Avatar icon="list" />}
          title={"Day Book"}
          subtitle={"Every voucher, newest first"}
          chevron
          onPress={() => router.push("/daybook")}
        />
        <ListRow
          left={<Avatar icon="layers" />}
          title={"Final accounts"}
          subtitle={"Trial balance, profit & loss, balance sheet"}
          chevron
          onPress={() => router.push("/final-accounts")}
        />
        {demo ? (
          <ListRow
            left={<Avatar icon="rotate-ccw" />}
            title={"Reset demo data"}
            subtitle={"Start again with fresh mock data"}
            onPress={resetDemo}
            last
          />
        ) : null}
      </View>

      <Txt variant="caption" tone="body" center>
        {APP_NAME} 0.1.0{demo ? " · mock data mode" : ""}
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.card,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: {
    width: "48%",
    flexGrow: 1,
    minHeight: 104,
    padding: 14,
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.card,
  },
});
