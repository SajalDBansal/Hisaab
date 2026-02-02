import { Redirect, router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { can, formatDate, formatINR, type Voucher } from "@repo/core";
import { useData } from "@/data/DataProvider";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Header,
  Icon,
  ListRow,
  Money,
  QueryView,
  Screen,
  Segmented,
  Txt,
  type IconName,
} from "@/components";
import {
  paymentModeShort,
  voucherBadge,
  voucherTypeIcon,
  voucherTypeLabel,
} from "@/data/labels";
import { useLedgers, useVouchers } from "@/data/queries";
import { colors, radius, space } from "@/theme";

type Direction = "all" | "in" | "out";
const PAGE = 20;

const TOOLS: { label: string; icon: IconName; href: Href }[] = [
  { label: "Receive", icon: "arrow-down-left", href: "/receipt/new" },
  { label: "Pay", icon: "arrow-up-right", href: "/payment/new" },
  { label: "Expense", icon: "credit-card", href: "/expense/new" },
  { label: "Contra", icon: "repeat", href: "/contra/new" },
  {
    label: "Reconcile",
    icon: "check-square",
    href: "/reconcile",
  },
];

/** Cash and bank accounts, plus every money-in and money-out voucher. */
export default function BankingScreen() {
  const { role } = useData();
  if (!role) return null;
  if (!can(role, "reports")) return <Redirect href="/sales" />;
  return <BankingBooks canWrite={can(role, "payments")} />;
}

function BankingBooks({ canWrite }: { canWrite: boolean }) {
  const ledgers = useLedgers();
  const vouchers = useVouchers({
    types: ["receipt", "payment", "expense", "contra"],
  });
  const [direction, setDirection] = useState<Direction>("all");
  const [shown, setShown] = useState(PAGE);

  return (
    <Screen
      header={<Header title="Banking" subtitle="Cash, bank and payments" />}
      onRefresh={() => {
        ledgers.refetch();
        vouchers.refetch();
      }}
      refreshing={ledgers.isRefetching || vouchers.isRefetching}
    >
      <QueryView query={ledgers}>
        {(list) => {
          const total = list.reduce((s, l) => s + l.balance, 0);
          return (
            <View style={{ gap: space.md }}>
              <View>
                <Txt variant="small" tone="body">
                  Cash and bank balance
                </Txt>
                <Money value={total} variant="display" />
              </View>
              {list.map((l) => (
                <Card
                  key={l.ledger.id}
                  onPress={() => router.push(`/ledger/${l.ledger.id}`)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.md,
                  }}
                >
                  <Avatar
                    icon={
                      l.ledger.kind === "cash" ? "dollar-sign" : "credit-card"
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{l.ledger.name}</Txt>
                    <Txt variant="small" tone="body">
                      {l.ledger.kind === "cash" ? "Cash book" : "Bank book"}
                    </Txt>
                  </View>
                  <Money
                    value={l.balance}
                    variant="bodyStrong"
                    style={{ fontWeight: "600" }}
                  />
                  <Icon name="chevron-right" size={18} color={colors.body} />
                </Card>
              ))}
            </View>
          );
        }}
      </QueryView>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: space.sm,
          justifyContent: "space-between",
        }}
      >
        {(canWrite ? TOOLS : []).map((t) => (
          <Pressable
            key={t.label}
            accessibilityRole="button"
            onPress={() => router.push(t.href)}
            style={{ alignItems: "center", gap: 6, minWidth: 72 }}
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
            <Txt variant="caption" style={{ fontWeight: "500" }}>
              {t.label}
            </Txt>
          </Pressable>
        ))}
      </View>

      <View style={{ gap: space.md }}>
        <Txt variant="heading">Payments</Txt>
        <Segmented
          value={direction}
          onChange={(d) => {
            setDirection(d);
            setShown(PAGE);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "in", label: "Money in" },
            { value: "out", label: "Money out" },
          ]}
        />
        <QueryView query={vouchers}>
          {(list) => {
            const filtered = list.filter(
              (v) =>
                direction === "all" ||
                (direction === "in"
                  ? v.type === "receipt"
                  : v.type === "payment" || v.type === "expense"),
            );
            if (filtered.length === 0)
              return <EmptyState icon="credit-card" title="No payments yet" />;
            return (
              <>
                <View>
                  {filtered.slice(0, shown).map((v, i, rows) => (
                    <MoneyRow key={v.id} v={v} last={i === rows.length - 1} />
                  ))}
                </View>
                {filtered.length > shown ? (
                  <Button
                    label={`Show ${Math.min(PAGE, filtered.length - shown)} more`}
                    onPress={() => setShown(shown + PAGE)}
                  />
                ) : null}
              </>
            );
          }}
        </QueryView>
      </View>
    </Screen>
  );
}

function MoneyRow({ v, last }: { v: Voucher; last: boolean }) {
  const isIn = v.type === "receipt";
  const badge = voucherBadge(v);
  if (v.type === "contra")
    // Transfer between own accounts: neither money in nor out of the business
    return (
      <ListRow
        left={<Avatar icon="repeat" />}
        title={v.narration ?? "Contra"}
        subtitle={`${v.number} · ${formatDate(v.date)}${v.reference ? ` · ${v.reference}` : ""}`}
        onPress={() => router.push(`/voucher/${v.id}`)}
        right={
          <Txt variant="bodyStrong" num style={{ fontWeight: "600" }}>
            ⇄ {formatINR(v.amount)}
          </Txt>
        }
        last={last}
      />
    );
  return (
    <ListRow
      left={<Avatar icon={voucherTypeIcon[v.type]} />}
      title={v.expenseHead ?? `${voucherTypeLabel[v.type]} · ${v.number}`}
      subtitle={`${v.expenseHead ? `${v.number} · ` : ""}${v.mode ? paymentModeShort[v.mode] : ""} · ${formatDate(v.date)}${v.tds ? ` · TDS ${v.tds.section}` : ""}`}
      onPress={() => router.push(`/voucher/${v.id}`)}
      right={
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Txt
            variant="bodyStrong"
            num
            tone={isIn ? "get" : "ink"}
            style={{ fontWeight: "600" }}
          >
            {isIn ? "+" : "−"}
            {formatINR(v.amount)}
          </Txt>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </View>
      }
      last={last}
    />
  );
}
