import { router } from "expo-router";
import { useMemo, useState } from "react";
import { useReportScope } from "@/data/reportScope";
import { scopeVouchers } from "@repo/core";
import { useGstMode } from "@/data/gstMode";
import { View } from "react-native";
import { formatDate, today, type Voucher, type VoucherType } from "@repo/core";
import {
  Avatar,
  Badge,
  Chip,
  ChipRow,
  EmptyState,
  Header,
  ListRow,
  Money,
  QueryView,
  TaxScopeFilter,
  Screen,
  Txt,
} from "@/components";
import { voucherBadge, voucherTypeIcon, voucherTypeLabel } from "@/data/labels";
import { useParties, useVouchers } from "@/data/queries";
import { colors, space } from "@/theme";

const TYPES: (VoucherType | "all")[] = [
  "all",
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "credit-note",
  "debit-note",
  "contra",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
];

/** Every voucher grouped by date, newest first, with a type filter. */
export default function DayBookScreen() {
  const [type, setType] = useState<VoucherType | "all">("all");
  const [scope, setScope] = useReportScope();
  const gst = useGstMode();
  const vouchers = useVouchers({});
  const parties = useParties();

  return (
    <Screen
      header={<Header title="Day Book" subtitle="All vouchers" />}
      onRefresh={() => vouchers.refetch()}
      refreshing={vouchers.isRefetching}
      contentStyle={{ gap: space.lg }}
    >
      <ChipRow>
        {TYPES.map((t) => (
          <Chip
            key={t}
            label={t === "all" ? "All types" : voucherTypeLabel[t]}
            selected={type === t}
            onPress={() => setType(t)}
          />
        ))}
      </ChipRow>
      <TaxScopeFilter value={scope} onChange={setScope} />
      <QueryView query={vouchers}>
        {(list) => (
          <QueryView query={parties}>
            {(rows) => (
              <Grouped
                list={scopeVouchers(
                  list,
                  scope,
                  gst.off ? "nongst" : "gst",
                  rows.map((r) => r.party),
                ).filter((v) => type === "all" || v.type === type)}
              />
            )}
          </QueryView>
        )}
      </QueryView>
    </Screen>
  );
}

function Grouped({ list }: { list: Voucher[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, Voucher[]>();
    for (const v of list) map.set(v.date, [...(map.get(v.date) ?? []), v]);
    return [...map.entries()];
  }, [list]);

  if (list.length === 0)
    return (
      <EmptyState
        icon="list"
        title="No vouchers"
        message="Vouchers you save will appear here."
      />
    );

  return (
    <>
      {groups.map(([date, rows]) => (
        <View key={date}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              paddingBottom: space.xs,
            }}
          >
            <Txt variant="label" tone="body">
              {date === today()
                ? `Today · ${formatDate(date)}`
                : formatDate(date)}
            </Txt>
            <Txt variant="label" tone="body">
              {rows.length} {rows.length === 1 ? "voucher" : "vouchers"}
            </Txt>
          </View>
          {rows.map((v, i) => {
            const badge = voucherBadge(v);
            return (
              <ListRow
                key={v.id}
                left={<Avatar icon={voucherTypeIcon[v.type]} />}
                title={v.number}
                subtitle={
                  v.expenseHead
                    ? `${voucherTypeLabel[v.type]} · ${v.expenseHead}`
                    : voucherTypeLabel[v.type]
                }
                onPress={() => router.push(`/voucher/${v.id}`)}
                right={
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    <Money
                      value={v.amount}
                      variant="bodyStrong"
                      style={
                        v.status === "cancelled"
                          ? {
                              textDecorationLine: "line-through",
                              color: colors.body,
                            }
                          : undefined
                      }
                    />
                    {badge ? (
                      <Badge label={badge.label} tone={badge.tone} />
                    ) : null}
                  </View>
                }
                last={i === rows.length - 1}
              />
            );
          })}
        </View>
      ))}
    </>
  );
}
