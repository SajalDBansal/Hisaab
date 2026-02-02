import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  formatDate,
  isOrderType,
  type OrderRow,
  type OrderStatus,
  type OrderType,
} from "@repo/core";
import {
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Header,
  ListRow,
  Money,
  QueryView,
  Screen,
  Segmented,
  Txt,
} from "@/components";
import { orderStatusBadge, voucherTypeLabel } from "@/data/labels";
import { useOrders } from "@/data/queries";
import { space } from "@/theme";

const TABS: { value: OrderType; label: string }[] = [
  { value: "estimate", label: "Estimates" },
  { value: "sales-order", label: "Orders" },
  { value: "delivery-note", label: "Challans" },
  { value: "purchase-order", label: "POs" },
];
const STATUSES: (OrderStatus | "all")[] = [
  "all",
  "open",
  "converted",
  "expired",
  "cancelled",
];

/** Estimates, sales orders, delivery challans and purchase orders. /orders?type=purchase-order */
export default function OrdersScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [type, setType] = useState<OrderType>(
    params.type && isOrderType(params.type) ? params.type : "estimate",
  );
  const [status, setStatus] = useState<OrderStatus | "all">("open");
  const orders = useOrders(type);

  return (
    <Screen
      header={
        <Header
          title="Estimates & orders"
          subtitle="Turn them into bills when ready"
          right={
            <Button
              label="New"
              size="sm"
              icon="plus"
              onPress={() => router.push(`/order/new?type=${type}`)}
            />
          }
        />
      }
      onRefresh={() => orders.refetch()}
      refreshing={orders.isRefetching}
    >
      <Segmented value={type} onChange={setType} options={TABS} />
      <QueryView query={orders}>
        {(rows) => (
          <List rows={rows} type={type} status={status} setStatus={setStatus} />
        )}
      </QueryView>
    </Screen>
  );
}

function List({
  rows,
  type,
  status,
  setStatus,
}: {
  rows: OrderRow[];
  type: OrderType;
  status: OrderStatus | "all";
  setStatus: (s: OrderStatus | "all") => void;
}) {
  const count = (s: OrderStatus) => rows.filter((r) => r.status === s).length;
  const visible = rows.filter((r) => status === "all" || r.status === status);
  const openValue = rows
    .filter((r) => r.status === "open")
    .reduce((s, r) => s + r.voucher.amount, 0);
  const statuses = STATUSES.filter(
    (s) => s !== "expired" || type === "estimate",
  );

  return (
    <>
      <View>
        <Txt variant="small" tone="body">
          Open {voucherTypeLabel[type].toLowerCase()}s
        </Txt>
        <Money value={openValue} variant="display" decimals={false} />
      </View>
      <ChipRow>
        {statuses.map((s) => (
          <Chip
            key={s}
            label={
              s === "all"
                ? `All · ${rows.length}`
                : `${orderStatusBadge[s].label} · ${count(s)}`
            }
            selected={status === s}
            onPress={() => setStatus(s)}
          />
        ))}
      </ChipRow>
      {visible.length === 0 ? (
        <EmptyState
          icon="clipboard"
          title={`No ${status === "all" ? "" : `${orderStatusBadge[status].label.toLowerCase()} `}${voucherTypeLabel[type].toLowerCase()}s`}
          message="Tap New to make one."
        />
      ) : (
        <View>
          {visible.map((r, i) => (
            <ListRow
              key={r.voucher.id}
              title={r.partyName}
              subtitle={`${r.voucher.number} · ${formatDate(r.voucher.date)}${
                r.convertedTo
                  ? ` · → ${r.convertedTo.number}`
                  : r.voucher.validUntil && r.status === "open"
                    ? ` · valid till ${formatDate(r.voucher.validUntil)}`
                    : ""
              }`}
              onPress={() => router.push(`/voucher/${r.voucher.id}`)}
              right={
                <View style={{ alignItems: "flex-end", gap: 3 }}>
                  <Money
                    value={r.voucher.amount}
                    variant="bodyStrong"
                    style={{ fontWeight: "600" }}
                  />
                  <Badge
                    label={orderStatusBadge[r.status].label}
                    tone={orderStatusBadge[r.status].tone}
                  />
                </View>
              }
              last={i === visible.length - 1}
            />
          ))}
        </View>
      )}
      <Txt variant="caption" tone="body" style={{ marginTop: space.xs }}>
        {type === "delivery-note"
          ? "Challans take goods out of stock until they are billed."
          : "These don't change stock or party balances until they become a bill."}
      </Txt>
    </>
  );
}
