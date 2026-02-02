import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, type PeriodKey } from "@repo/core";
import {
  BarRow,
  Button,
  Card,
  EmptyState,
  Header,
  Money,
  PeriodChips,
  QueryView,
  Screen,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { accountHref } from "@/data/labels";
import { useExpenseSummary } from "@/data/queries";
import { space } from "@/theme";

/** Expenses by head for a period: paid expenses, journals (salary, depreciation) and freight. */
export default function ExpensesReportScreen() {
  const [period, setPeriod] = useState<PeriodKey>("fy");
  const summary = useExpenseSummary(period);

  return (
    <Screen
      header={
        <Header
          title="Expense summary"
          subtitle="Incl. journals and purchase freight"
          right={
            <Button
              label="Add"
              size="sm"
              icon="plus"
              onPress={() => router.push("/expense/new")}
            />
          }
        />
      }
      onRefresh={() => summary.refetch()}
      refreshing={summary.isRefetching}
    >
      <PeriodChips value={period} onChange={setPeriod} />
      <TaxScopeFilter />
      <QueryView query={summary}>
        {(s) => {
          if (s.heads.length === 0)
            return (
              <EmptyState
                icon="credit-card"
                title="No expenses in this period"
              />
            );
          const max = Math.max(1, ...s.heads.map((h) => h.total));
          return (
            <>
              <Card variant="dark" style={{ gap: space.sm }}>
                <Txt variant="small" tone="onDarkMute">
                  Total expenses · {s.heads.length} heads
                </Txt>
                <Money value={s.total} variant="display" tone="onDark" />
                <Txt variant="caption" tone="onDarkMute">
                  Biggest: {s.heads[0].head} (
                  {Math.round((s.heads[0].total / s.total) * 100)}%)
                </Txt>
              </Card>
              <View>
                {s.heads.map((h) => (
                  <BarRow
                    key={h.head}
                    title={h.head}
                    subtitle={`${h.entries} ${h.entries === 1 ? "entry" : "entries"} · ${Math.round((h.total / s.total) * 100)}%`}
                    value={formatINR(h.total, { decimals: false })}
                    share={h.total / max}
                    onPress={() =>
                      router.push(accountHref(`expense:${h.head}`))
                    }
                  />
                ))}
              </View>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
