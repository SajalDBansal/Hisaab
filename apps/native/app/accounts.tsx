import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { type ChartGroup } from "@repo/core";
import {
  Avatar,
  Card,
  Header,
  Icon,
  IconButton,
  ListRow,
  Money,
  QueryView,
  Screen,
  TaxScopeFilter,
  Txt,
  type IconName,
} from "@/components";
import { accountHref, drCr } from "@/data/labels";
import { useChart, useFinalAccounts } from "@/data/queries";
import { colors, radius, space } from "@/theme";

const TOOLS: { label: string; icon: IconName; href: Href }[] = [
  { label: "Entries", icon: "edit-3", href: "/accounting" },
  { label: "Trial balance", icon: "columns", href: "/final-accounts?view=tb" },
  { label: "P&L", icon: "trending-up", href: "/final-accounts?view=pl" },
  { label: "Balance sheet", icon: "layers", href: "/final-accounts?view=bs" },
];

/** Chart of accounts: groups under their headings, tap a group to see its accounts. */
export default function AccountsScreen() {
  const chart = useChart();
  const final = useFinalAccounts();

  return (
    <Screen
      header={
        <Header
          title="Accounting"
          subtitle="Chart of accounts"
          right={
            <IconButton
              icon="download"
              label="Download accounting reports"
              onPress={() => router.push("/settings/reports")}
            />
          }
        />
      }
      onRefresh={() => {
        chart.refetch();
        final.refetch();
      }}
      refreshing={chart.isRefetching}
    >
      <TaxScopeFilter />
      <QueryView query={final}>
        {(f) => {
          const np = f.profitAndLoss.netProfit;
          return (
            <Card
              variant="dark"
              onPress={() => router.push("/final-accounts?view=pl")}
              style={{ gap: space.sm }}
            >
              <Txt variant="small" tone="onDarkMute">
                {np >= 0 ? "Net profit" : "Net loss"} · this year
              </Txt>
              <Money value={Math.abs(np)} variant="display" tone="onDark" />
              <View style={{ flexDirection: "row", gap: space.xl }}>
                <View>
                  <Txt variant="caption" tone="onDarkMute">
                    Gross profit
                  </Txt>
                  <Money
                    value={f.profitAndLoss.grossProfit}
                    variant="small"
                    tone="onDark"
                    decimals={false}
                  />
                </View>
                <View>
                  <Txt variant="caption" tone="onDarkMute">
                    Sales
                  </Txt>
                  <Money
                    value={f.profitAndLoss.sales}
                    variant="small"
                    tone="onDark"
                    decimals={false}
                  />
                </View>
              </View>
            </Card>
          );
        }}
      </QueryView>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {TOOLS.map((t) => (
          <Pressable
            key={t.label}
            accessibilityRole="button"
            onPress={() => router.push(t.href)}
            style={{ alignItems: "center", gap: 6, flex: 1, minWidth: 60 }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSoft,
                borderWidth: 1,
                borderColor: colors.hairline,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={t.icon} size={22} />
            </View>
            <Txt variant="caption" center style={{ fontWeight: "500" }}>
              {t.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      <QueryView query={chart}>
        {(groups) => <Chart groups={groups} />}
      </QueryView>
    </Screen>
  );
}

function Chart({ groups }: { groups: ChartGroup[] }) {
  const [open, setOpen] = useState<string | null>("Bank Accounts");
  const parents = [...new Set(groups.map((g) => g.group.parent))];

  return (
    <View style={{ gap: space.lg }}>
      {parents.map((parent) => (
        <View key={parent} style={{ gap: space.sm }}>
          <Txt variant="heading">{parent}</Txt>
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: radius.card,
              overflow: "hidden",
            }}
          >
            {groups
              .filter((g) => g.group.parent === parent)
              .map((g, i, list) => {
                const isOpen = open === g.group.name;
                const last = i === list.length - 1;
                return (
                  <View
                    key={g.group.name}
                    style={
                      !last && {
                        borderBottomWidth: 1,
                        borderBottomColor: colors.hairline,
                      }
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isOpen }}
                      onPress={() => setOpen(isOpen ? null : g.group.name)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.sm,
                        minHeight: 52,
                        paddingHorizontal: 14,
                        backgroundColor: pressed
                          ? colors.surfaceSoft
                          : colors.canvas,
                      })}
                    >
                      <Icon
                        name={isOpen ? "chevron-down" : "chevron-right"}
                        size={18}
                        color={colors.body}
                      />
                      <View style={{ flex: 1 }}>
                        <Txt variant="bodyStrong">{g.group.name}</Txt>
                        <Txt variant="caption" tone="body">
                          {g.accounts.length === 0
                            ? "No accounts yet"
                            : `${g.accounts.length} account${g.accounts.length > 1 ? "s" : ""}`}
                        </Txt>
                      </View>
                      <Txt variant="small" num style={{ fontWeight: "600" }}>
                        {drCr(g.balance, false)}
                      </Txt>
                    </Pressable>
                    {isOpen && g.accounts.length > 0 ? (
                      <View
                        style={{
                          backgroundColor: colors.surfaceSoft,
                          paddingHorizontal: 14,
                        }}
                      >
                        {g.accounts.map((a, j) => (
                          <ListRow
                            key={a.key}
                            left={<Avatar size={32} name={a.name} />}
                            title={a.name}
                            onPress={() => router.push(accountHref(a.key))}
                            right={
                              <Txt variant="small" num>
                                {drCr(a.balance)}
                              </Txt>
                            }
                            chevron
                            last={j === g.accounts.length - 1}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}
          </View>
        </View>
      ))}
      <Txt variant="caption" tone="body" center>
        Balances include opening balances. Dr = debit, Cr = credit.
      </Txt>
    </View>
  );
}
