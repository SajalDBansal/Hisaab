import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { formatDate, formatINR, type TradeRateEntry } from "@repo/core";
import {
  EmptyState,
  Header,
  KeyValue,
  ListRow,
  QueryView,
  Screen,
  Txt,
} from "@/components";
import { useParty, usePartyItemRates, usePartyItems } from "@/data/queries";
import { useGstMode } from "@/data/gstMode";
import { space } from "@/theme";

const LABEL: Record<TradeRateEntry["type"], string> = {
  purchase: "Purchase",
  sale: "Sale",
  "debit-note": "Purchase return",
  "credit-note": "Sales return",
};

/** Every rate one party got for one product, newest first. */
export default function TradeRateHistoryScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const gst = useGstMode();
  const party = useParty(id);
  const items = usePartyItems(id);
  const history = usePartyItemRates(id, itemId);
  const row = items.data?.rows.find((r) => r.itemId === itemId);
  const unit = row?.unit ?? "";

  return (
    <Screen
      header={
        <Header
          title={row?.itemName ?? "Rate history"}
          subtitle={party.data?.party.name}
        />
      }
      onRefresh={() => history.refetch()}
      refreshing={history.isRefetching}
      contentStyle={{ gap: space.lg }}
    >
      <QueryView query={history}>
        {(entries) => {
          const bills = entries.filter((e) => e.qty > 0);
          if (!bills.length)
            return (
              <EmptyState
                icon="clock"
                title="No bills yet"
                message="Rates appear here once this product is on a bill."
              />
            );
          const rates = bills.map((e) => e.rate);
          const qty = bills.reduce((s, e) => s + e.qty, 0);
          const average = bills.reduce((s, e) => s + e.rate * e.qty, 0) / qty;
          const per = (paise: number) =>
            `${formatINR(paise)}${unit ? ` / ${unit}` : ""}`;
          return (
            <>
              <View>
                <KeyValue
                  label="Latest rate"
                  value={per(bills[0].rate)}
                  strong
                />
                <KeyValue label="Lowest" value={per(Math.min(...rates))} />
                <KeyValue label="Highest" value={per(Math.max(...rates))} />
                <KeyValue label="Average, by quantity" value={per(average)} />
                {row?.stockQty !== null && row?.stockQty !== undefined ? (
                  <KeyValue
                    label="Their stock on hand"
                    value={`${row.stockQty} ${unit}`}
                  />
                ) : null}
                <Txt variant="caption" tone="body">
                  Rates are per unit, after line discount, before GST.
                </Txt>
              </View>
              <View>
                {entries.map((e, i) => (
                  <ListRow
                    key={`${e.voucherId}:${i}`}
                    title={e.number}
                    subtitle={[
                      LABEL[e.type],
                      formatDate(e.date),
                      `${Math.abs(e.qty)} ${unit}`,
                      e.typedRate !== e.rate
                        ? `billed at ${formatINR(e.typedRate)}`
                        : null,
                      gst.on ? `GST ${e.gstRate}%` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    right={
                      <Txt
                        variant="bodyStrong"
                        num
                        tone={e.qty < 0 ? "body" : "ink"}
                      >
                        {per(e.rate)}
                      </Txt>
                    }
                    onPress={() => router.push(`/voucher/${e.voucherId}`)}
                    last={i === entries.length - 1}
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
