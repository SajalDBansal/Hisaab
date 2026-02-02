/**
 * One list screen for Sales invoices and Purchase bills:
 * period and status filters, search, totals and "Show more" paging.
 */
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import {
  formatDate,
  formatINR,
  lastMonths,
  monthLabel,
  today,
  yearMonth,
  type InvoiceRow,
  type InvoiceStatus,
  type TaxScope,
  voucherInScope,
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
  QueryView,
  Screen,
  TaxScopeFilter,
  Txt,
  type BadgeTone,
} from "@/components";
import { useInvoices } from "@/data/queries";
import { colors, radius, space } from "@/theme";

const PAGE = 20;

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
  const invoices = useInvoices(kind);
  const isSale = kind === "sale";
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
      onRefresh={() => invoices.refetch()}
      refreshing={invoices.isRefetching}
      contentStyle={{ gap: space.lg }}
    >
      <QueryView query={invoices}>
        {(rows) => <Body rows={rows} isSale={isSale} />}
      </QueryView>
    </Screen>
  );
}

function Body({ rows, isSale }: { rows: InvoiceRow[]; isSale: boolean }) {
  const months = lastMonths(today(), 3).reverse(); // this month first
  const [month, setMonth] = useState<string | "all">(months[0]);
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [scope, setScope] = useState<TaxScope>("all");

  const inPeriod = useMemo(
    () =>
      rows
        .filter((r) => voucherInScope(r.voucher, scope))
        .filter((r) => month === "all" || yearMonth(r.voucher.date) === month),
    [rows, month, scope],
  );
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inPeriod
      .filter((r) => status === "all" || r.status === status)
      .filter(
        (r) =>
          !q ||
          `${r.partyName} ${r.voucher.number} ${r.voucher.supplierInvoiceNo ?? ""}`
            .toLowerCase()
            .includes(q),
      );
  }, [inPeriod, status, search]);

  // Totals for the chosen period (posted invoices only)
  const posted = inPeriod.filter((r) => r.voucher.status === "posted");
  const total = posted.reduce((s, r) => s + r.voucher.amount, 0);
  const settled = posted.reduce(
    (s, r) => s + Math.min(r.settled, r.voucher.amount),
    0,
  );
  const due = posted.reduce((s, r) => s + r.pending, 0);
  const count = (st: InvoiceStatus) =>
    inPeriod.filter((r) => r.status === st).length;

  return (
    <>
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
          value={formatINR(total, { decimals: false })}
        />
        <Stat
          label={isSale ? "Received" : "Paid"}
          value={formatINR(settled, { decimals: false })}
          divider
        />
        <Stat
          label="Due"
          value={formatINR(due, { decimals: false })}
          divider
          warn={due > 0}
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
          style={{ flex: 1, fontSize: 14, minHeight: 40, color: colors.ink }}
        />
      </View>

      <ChipRow>
        <Chip
          label="All status"
          selected={status === "all"}
          onPress={() => setStatus("all")}
        />
        {STATUS_ORDER.map((st) => (
          <Chip
            key={st}
            label={`${STATUS[st].label} · ${count(st)}`}
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
          {visible.slice(0, shown).map((r, i, list) => (
            <ListRow
              key={r.voucher.id}
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
              last={i === list.length - 1}
            />
          ))}
        </View>
      )}

      {visible.length > shown ? (
        <Button
          label={`Show ${Math.min(PAGE, visible.length - shown)} more`}
          onPress={() => setShown(shown + PAGE)}
        />
      ) : visible.length > 0 ? (
        <Txt variant="caption" tone="body" center>
          {visible.length} {isSale ? "invoices" : "bills"}
        </Txt>
      ) : null}
    </>
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
