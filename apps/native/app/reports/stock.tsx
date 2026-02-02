import { router } from "expo-router";
import { useReportScope } from "@/data/reportScope";
import { View } from "react-native";
import { formatINR, count } from "@repo/core";
import {
  Badge,
  Card,
  Header,
  ListRow,
  TaxScopeFilter,
  Money,
  QueryView,
  Screen,
  Txt,
} from "@/components";
import { useStockSummary } from "@/data/queries";
import { space } from "@/theme";

/** Closing stock by item group, using each lot's saved acquisition cost. */
export default function StockReportScreen() {
  const [scope, setScope] = useReportScope();
  const report = useStockSummary(scope);
  return (
    <Screen
      header={
        <Header title="Stock summary" subtitle="Historical stock-lot cost" />
      }
      onRefresh={() => report.refetch()}
      refreshing={report.isRefetching}
    >
      <TaxScopeFilter value={scope} onChange={setScope} />
      <QueryView query={report}>
        {(s) => (
          <>
            <Card variant="dark" style={{ gap: space.sm }}>
              <Txt variant="small" tone="onDarkMute">
                Stock value · {count(s.itemCount, "item")}
              </Txt>
              <Money value={s.totalValue} variant="display" tone="onDark" />
              <Txt variant="caption" tone="onDarkMute">
                {s.lowCount > 0
                  ? `${count(s.lowCount, "item")} below reorder level`
                  : "All items above reorder level"}
              </Txt>
            </Card>
            {s.groups.map((g) => (
              <View key={g.group}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: space.xs,
                  }}
                >
                  <Txt variant="heading">{g.group}</Txt>
                  <Txt variant="small" tone="body" num>
                    {formatINR(g.value, { decimals: false })} ·{" "}
                    {Math.round((g.value / Math.max(1, s.totalValue)) * 100)}%
                  </Txt>
                </View>
                {g.items.map((it, i) => (
                  <ListRow
                    key={it.itemId}
                    title={it.name}
                    subtitle={`${it.qtyLabel} in stock`}
                    onPress={() => router.push(`/item/${it.itemId}`)}
                    right={
                      <View style={{ alignItems: "flex-end", gap: 3 }}>
                        <Money
                          value={it.value}
                          variant="bodyStrong"
                          decimals={false}
                          style={{ fontWeight: "600" }}
                        />
                        {it.low ? (
                          <Badge label="Low stock" tone="warn" />
                        ) : null}
                      </View>
                    }
                    last={i === g.items.length - 1}
                  />
                ))}
              </View>
            ))}
          </>
        )}
      </QueryView>
    </Screen>
  );
}
