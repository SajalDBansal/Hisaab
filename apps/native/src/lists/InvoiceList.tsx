/**
 * One list screen for Sales invoices and Purchase bills:
 * period and status filters, search and totals from the server, and the next
 * page loaded as the user scrolls.
 */
import { router } from "expo-router";
import { useState } from "react";
import { TextInput, View } from "react-native";
import {
  formatDate,
  formatINR,
  lastMonths,
  monthLabel,
  today,
  type InvoiceRow,
  type InvoiceStatus,
  type TaxScope,
  voucherMode,
} from "@repo/core";
import {
  Badge,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Header,
  Icon,
  ListRow,
  Money,
  PagedView,
  Screen,
  TaxScopeFilter,
  Txt,
  type BadgeTone,
} from "@/components";
import { useInvoicePages } from "@/data/pagedQueries";
import { useDebounced } from "@/data/useDebounced";
import { colors, radius, space } from "@/theme";

const STATUS: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  unpaid: { label: "Unpaid", tone: "neutral" },
  partial: { label: "Partial", tone: "warn" },
  overdue: { label: "Overdue", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  draft: { label: "Draft", tone: "dashed" },
  cancelled: { label: "Cancelled", tone: "bad" },
};
const STATUS_ORDER: InvoiceStatus[] = [
  "unpaid",
  "partial",
  "overdue",
  "paid",
  "draft",
  "cancelled",
];

export function InvoiceList({ kind }: { kind: "sale" | "purchase" }) {
  const isSale = kind === "sale";
  const months = lastMonths(today(), 3).reverse(); // this month first
  const [month, setMonth] = useState<string>(months[0]);
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<TaxScope>("all");
  const query = useDebounced(search);
  const invoices = useInvoicePages(kind, {
    month,
    status: status === "all" ? undefined : status,
    search: query,
    scope,
  });
  return (
    <Screen
      header={
        <Header
          title={isSale ? "Sales" : "Purchase"}
          subtitle={isSale ? "Tax invoices" : "Purchase bills"}
          right={
            <Button
              label={isSale ? "New invoice" : "New bill"}
              size="sm"
              icon="plus"
              onPress={() =>
                router.push(isSale ? "/sale/new" : "/purchase/new")
              }
            />
          }
        />
      }
      onRefresh={() => invoices.query.refetch()}
      refreshing={
        invoices.query.isRefetching && !invoices.query.isFetchingNextPage
      }
      onEndReached={invoices.loadMore}
      contentStyle={{ gap: space.lg }}
    >
      <ChipRow>
        {months.map((m, i) => (
          <Chip
            key={m}
            label={i === 0 ? "This month" : monthLabel(m)}
            selected={month === m}
            onPress={() => setMonth(m)}
          />
        ))}
        <Chip
          label="All"
          selected={month === "all"}
          onPress={() => setMonth("all")}
        />
      </ChipRow>

      <TaxScopeFilter value={scope} onChange={setScope} />

      <PagedView list={invoices} noun={isSale ? "invoices" : "bills"}>
        {({ items: visible, summary }) => (
          <>
            <View
              style={{
                flexDirection: "row",
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: radius.card,
              }}
            >
              <Stat
                label={isSale ? "Invoiced" : "Billed"}
                value={formatINR(summary.amount, { decimals: false })}
              />
              <Stat
                label={isSale ? "Received" : "Paid"}
                value={formatINR(summary.settled, { decimals: false })}
                divider
              />
              <Stat
                label="Due"
                value={formatINR(summary.due, { decimals: false })}
                divider
                warn={summary.due > 0}
              />
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                minHeight: 44,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                backgroundColor: colors.surfaceSoft,
              }}
            >
              <Icon name="search" size={18} color={colors.body} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={
                  isSale
                    ? "Customer or invoice no."
                    : "Supplier, bill or supplier invoice no."
                }
                placeholderTextColor={colors.mute}
                accessibilityLabel="Search"
                style={{
                  flex: 1,
                  fontSize: 14,
                  minHeight: 40,
                  color: colors.ink,
                }}
              />
            </View>

            <ChipRow>
              <Chip
                label={`All status · ${summary.inPeriod}`}
                selected={status === "all"}
                onPress={() => setStatus("all")}
              />
              {STATUS_ORDER.map((st) => (
                <Chip
                  key={st}
                  label={`${STATUS[st].label} · ${summary.counts[st] ?? 0}`}
                  selected={status === st}
                  onPress={() => setStatus(st)}
                />
              ))}
            </ChipRow>

            {visible.length === 0 ? (
              <EmptyState
                icon="file-text"
                title={isSale ? "No invoices here" : "No bills here"}
                message="Try another month or status, or clear the search."
              />
            ) : (
              <View>
                {visible.map((r, i, list) => (
                  <InvoiceRowView
                    key={r.voucher.id}
                    r={r}
                    last={i === list.length - 1}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </PagedView>
    </Screen>
  );
}

function InvoiceRowView({ r, last }: { r: InvoiceRow; last: boolean }) {
  return (
    <ListRow
      title={r.partyName}
      subtitle={`${r.voucher.number} · ${formatDate(r.voucher.date)}${r.voucher.docType === "bill-of-supply" ? " · Bill of supply" : r.voucher.interState && voucherMode(r.voucher) === "regular" ? " · IGST" : ""}`}
      onPress={() => router.push(`/voucher/${r.voucher.id}`)}
      right={
        <View style={{ alignItems: "flex-end", gap: 3 }}>
          <Money
            value={r.voucher.amount}
            variant="bodyStrong"
            style={
              r.status === "cancelled"
                ? {
                    textDecorationLine: "line-through",
                    color: colors.body,
                  }
                : { fontWeight: "600" }
            }
          />
          <Badge
            label={
              r.status === "partial" || r.status === "overdue"
                ? `${STATUS[r.status].label} · ${formatINR(r.pending, { decimals: false })} due`
                : STATUS[r.status].label
            }
            tone={STATUS[r.status].tone}
          />
        </View>
      }
      last={last}
    />
  );
}

function Stat({
  label,
  value,
  divider,
  warn,
}: {
  label: string;
  value: string;
  divider?: boolean;
  warn?: boolean;
}) {
  return (
    <View
      style={{
        flex: 1,
        padding: 12,
        borderLeftWidth: divider ? 1 : 0,
        borderLeftColor: colors.hairline,
      }}
    >
      <Txt variant="caption" tone="body">
        {label}
      </Txt>
      <Txt
        variant="heading"
        num
        tone={warn ? "warn" : "ink"}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {value}
      </Txt>
    </View>
  );
}
