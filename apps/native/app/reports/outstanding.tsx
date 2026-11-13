import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  formatINR,
  type Ageing,
  type Outstanding,
  type PartyType,
  count,
} from "@repo/core";
import {
  Badge,
  Card,
  EmptyState,
  Header,
  ListRow,
  Money,
  QueryView,
  Screen,
  TaxScopeFilter,
  Segmented,
  Txt,
} from "@/components";
import { useOutstanding } from "@/data/queries";
import { colors, radius, space } from "@/theme";
import { useReveal } from "@/data/useReveal";

const BUCKETS: (keyof Ageing)[] = ["0-30", "31-60", "61-90", "90+"];
// Darker = older. Greys only, as in design.md.
const SHADES = ["#d4d4d4", "#a3a3a3", "#525252", "#000000"];

/** Receivables or payables: total, ageing and the party list. */
export default function OutstandingScreen() {
  // Parties are drawn a page at a time as the user scrolls.
  const reveal = useReveal();
  const params = useLocalSearchParams<{ type?: PartyType }>();
  const [type, setType] = useState<PartyType>(params.type ?? "customer");
  const report = useOutstanding(type);
  const isCustomer = type === "customer";

  return (
    <Screen
      header={
        <Header
          title={isCustomer ? "Receivables" : "Payables"}
          subtitle={
            isCustomer ? "Money customers owe you" : "Money you owe suppliers"
          }
        />
      }
      onRefresh={() => report.refetch()}
      refreshing={report.isRefetching}
      onEndReached={reveal.more}
    >
      <TaxScopeFilter />
      <Segmented
        value={type}
        onChange={setType}
        options={[
          { value: "customer", label: "Receivables" },
          { value: "supplier", label: "Payables" },
        ]}
      />
      <QueryView query={report}>
        {(r) => <Body r={r} shown={reveal.count} />}
      </QueryView>
    </Screen>
  );
}

function Body({ r, shown }: { r: Outstanding; shown: number }) {
  const isCustomer = r.type === "customer";
  if (r.rows.length === 0)
    return (
      <EmptyState
        icon="check-circle"
        title="Nothing outstanding"
        message={
          isCustomer
            ? "Every customer has paid."
            : "You've paid every supplier."
        }
      />
    );
  const aged = BUCKETS.reduce((s, b) => s + r.ageing[b], 0);
  return (
    <>
      <Card variant="dark" style={{ gap: space.sm }}>
        <Txt variant="small" tone="onDarkMute">
          {isCustomer ? "You'll get" : "You'll give"} ·{" "}
          {count(r.rows.length, "party", "parties")}
        </Txt>
        <Money value={r.total} variant="display" tone="onDark" />
        <Txt variant="caption" tone="onDarkMute">
          {formatINR(r.overdue, { decimals: false })} overdue
        </Txt>
      </Card>

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Ageing of open bills</Txt>
        <View
          style={{
            flexDirection: "row",
            height: 12,
            borderRadius: radius.pill,
            overflow: "hidden",
            backgroundColor: colors.hairlineSoft,
          }}
        >
          {BUCKETS.map((b, i) =>
            r.ageing[b] > 0 ? (
              <View
                key={b}
                style={{ flex: r.ageing[b], backgroundColor: SHADES[i] }}
              />
            ) : null,
          )}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {BUCKETS.map((b, i) => (
            <View key={b} style={{ flex: 1, gap: 2 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: SHADES[i],
                  }}
                />
                <Txt variant="caption" tone="body">
                  {b} days
                </Txt>
              </View>
              <Txt
                variant="small"
                num
                adjustsFontSizeToFit
                numberOfLines={1}
                style={{ fontWeight: "600" }}
              >
                {formatINR(r.ageing[b], { decimals: false })}
              </Txt>
              <Txt variant="caption" tone="body" num>
                {aged ? Math.round((r.ageing[b] / aged) * 100) : 0}%
              </Txt>
            </View>
          ))}
        </View>
        {r.onAccount > 0 ? (
          <Txt variant="caption" tone="body">
            {formatINR(r.onAccount)} {isCustomer ? "received" : "paid"} but not
            yet matched to a bill is taken off the total.
          </Txt>
        ) : null}
      </View>

      <View>
        <Txt variant="heading" style={{ marginBottom: space.xs }}>
          Parties · biggest first
        </Txt>
        {r.rows.slice(0, shown).map((row, i, rows) => (
          <ListRow
            key={row.partyId}
            title={row.name}
            subtitle={
              row.overdue > 0
                ? `${row.city} · ${formatINR(row.overdue, { decimals: false })} overdue up to ${count(row.maxOverdueDays, "day")}`
                : `${row.city} · not due yet`
            }
            onPress={() => router.push(`/party/${row.partyId}`)}
            right={
              <View style={{ alignItems: "flex-end", gap: 3 }}>
                <Money
                  value={row.amount}
                  variant="bodyStrong"
                  style={{ fontWeight: "600" }}
                />
                {row.maxOverdueDays > 60 ? (
                  <Badge label="60+ days" tone="warn" />
                ) : null}
              </View>
            }
            last={i === rows.length - 1}
          />
        ))}
      </View>
    </>
  );
}
