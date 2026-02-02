import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useReportScope } from "@/data/reportScope";
import { View } from "react-native";
import {
  formatINR,
  type PeriodKey,
  type TradeSummary,
} from "@repo/core";
import {
  BarRow,
  Card,
  EmptyState,
  Header,
  Money,
  PeriodChips,
  QueryView,
  Screen,
  Segmented,
  TaxScopeFilter,
  Txt,
} from "@/components";
import { useTradeSummary } from "@/data/queries";
import { space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

type By = "month" | "party" | "item";
const inr = (p: number) => formatINR(p, { decimals: false });

/** Sales or purchase summary for a period, broken down by month, party or item. */
export default function TradeSummaryScreen() {
  const gst = useGstMode();
  const { kind = "sale" } = useLocalSearchParams<{
    kind?: "sale" | "purchase";
  }>();
  const [period, setPeriod] = useState<PeriodKey>("fy");
  const [by, setBy] = useState<By>("month");
  const [scope, setScope] = useReportScope();
  const summary = useTradeSummary(kind, period, scope);
  const isSale = kind === "sale";

  return (
    <Screen
      header={
        <Header
          title={isSale ? "Sales summary" : "Purchase summary"}
          subtitle={
            gst.regular ? "Posted invoices, including GST" : "Posted bills"
          }
        />
      }
      onRefresh={() => summary.refetch()}
      refreshing={summary.isRefetching}
    >
      <PeriodChips value={period} onChange={setPeriod} />
      <TaxScopeFilter value={scope} onChange={setScope} />
      <QueryView query={summary}>
        {(s) =>
          s.count === 0 ? (
            <EmptyState
              icon={isSale ? "file-text" : "shopping-cart"}
              title={
                isSale
                  ? "No sales in this period"
                  : "No purchases in this period"
              }
              message="Try a longer period."
            />
          ) : (
            <Body s={s} isSale={isSale} by={by} setBy={setBy} />
          )
        }
      </QueryView>
    </Screen>
  );
}

function Body({
  s,
  isSale,
  by,
  setBy,
}: {
  s: TradeSummary;
  isSale: boolean;
  by: By;
  setBy: (b: By) => void;
}) {
  const months = s.byMonth;
  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const maxParty = Math.max(1, ...s.byParty.map((p) => p.total));
  const maxItem = Math.max(1, ...s.byItem.map((p) => p.taxable));

  return (
    <>
      <Card variant="dark" style={{ gap: space.sm }}>
        <Txt variant="small" tone="onDarkMute">
          {isSale ? "Total sales" : "Total purchases"} · {s.count}{" "}
          {isSale ? "invoices" : "bills"}
        </Txt>
        <Money value={s.total} variant="display" tone="onDark" />
        <View style={{ flexDirection: "row", gap: space.xl }}>
          <View>
            <Txt variant="caption" tone="onDarkMute">
              {s.tax ? "Taxable value" : "Value"}
            </Txt>
            <Txt variant="small" tone="onDark" num>
              {inr(s.taxable)}
            </Txt>
          </View>
          {s.tax ? (
            <View>
              <Txt variant="caption" tone="onDarkMute">
                GST
              </Txt>
              <Txt variant="small" tone="onDark" num>
                {inr(s.tax)}
              </Txt>
            </View>
          ) : null}
          <View>
            <Txt variant="caption" tone="onDarkMute">
              Average
            </Txt>
            <Txt variant="small" tone="onDark" num>
              {inr(Math.round(s.total / s.count))}
            </Txt>
          </View>
        </View>
      </Card>

      <Segmented
        value={by}
        onChange={setBy}
        options={[
          { value: "month", label: "By month" },
          { value: "party", label: isSale ? "By customer" : "By supplier" },
          { value: "item", label: "By item" },
        ]}
      />

      <View>
        {by === "month"
          ? months.map((m) => (
              <BarRow
                key={m.month}
                title={`${m.label} ${m.month.slice(0, 4)}`}
                value={inr(m.total)}
                share={m.total / maxMonth}
              />
            ))
          : by === "party"
            ? s.byParty.map((p) => (
                <BarRow
                  key={p.partyId}
                  title={p.name}
                  subtitle={`${p.count} ${isSale ? "invoices" : "bills"} · ${Math.round((p.total / s.total) * 100)}% of total`}
                  value={inr(p.total)}
                  share={p.total / maxParty}
                  onPress={() => router.push(`/party/${p.partyId}`)}
                />
              ))
            : s.byItem.map((it) => (
                <BarRow
                  key={it.itemId}
                  title={it.name}
                  subtitle={s.tax ? `${it.qtyLabel} · before GST` : it.qtyLabel}
                  value={inr(it.taxable)}
                  share={it.taxable / maxItem}
                  onPress={() => router.push(`/item/${it.itemId}`)}
                />
              ))}
      </View>
    </>
  );
}
