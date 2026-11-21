import { formatText } from "@/data/text";
import { Redirect, router } from "expo-router";
import { FirmDetail } from "@repo/contracts";
import { REQUIRE_LOGIN } from "@/auth/config";
import { Fragment, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import {
  can,
  DASHBOARD_CARDS,
  formatDate,
  formatINR,
  monthLabel,
  type DashboardCardId,
  type DashboardData,
} from "@repo/core";
import {
  Avatar,
  Badge,
  BarRow,
  Button,
  Card,
  ChipRow,
  FirmBar,
  LineChart,
  ListRow,
  Money,
  PairedBarChart,
  QueryView,
  Screen,
  TaxScopeFilter,
  SectionHeader,
  Txt,
} from "@/components";
import { useDashboard, useFirm } from "@/data/queries";
import { useData } from "@/data/DataProvider";
import { useDashboardLayout } from "@/data/dashboardLayout";
import { voucherBadge, voucherTypeIcon, voucherTypeLabel } from "@/data/labels";

import { useSendReminder } from "@/data/share";
import { colors, space } from "@/theme";

/**
 * Home dashboard. All figures come from reportService.dashboard() (see @repo/core),
 * one read; the cards, their order and which are hidden come from the person's
 * layout on this device (Settings → Customise dashboard, doc 37 T63).
 */
export default function HomeScreen() {
  const firm = useFirm();
  return (
    <QueryView query={firm}>
      {(data) => {
        const permissions = FirmDetail.safeParse(data).data?.permissions ?? [];
        if (REQUIRE_LOGIN && !permissions.includes("reports"))
          return <Redirect href="/sales" />;
        return (
          <HomeDashboard
            canCreate={!REQUIRE_LOGIN || permissions.includes("sales")}
          />
        );
      }}
    </QueryView>
  );
}

/** Restricted roles never mount or fetch the financial dashboard. */
function HomeDashboard({ canCreate }: { canCreate: boolean }) {
  const firm = useFirm();
  const dashboard = useDashboard();

  return (
    <Screen
      header={
        <FirmBar
          firmName={firm.data?.name ?? " "}
          fyLabel={firm.data?.fyLabel ?? ""}
          city={firm.data?.city ?? ""}
          onPressFirm={() => router.push("/firms")}
        />
      }
      onRefresh={() => dashboard.refetch()}
      refreshing={dashboard.isRefetching}
    >
      <TaxScopeFilter />
      <QueryView query={dashboard}>
        {(d) => <Dashboard d={d} canCreate={canCreate} />}
      </QueryView>
    </Screen>
  );
}

function Dashboard({ d, canCreate }: { d: DashboardData; canCreate: boolean }) {
  const sendReminder = useSendReminder();
  const { role } = useData();
  const layout = useDashboardLayout({ canCreate });
  const canPay = !REQUIRE_LOGIN || (!!role && can(role, "purchase"));

  const lastTrend = d.cashTrend[d.cashTrend.length - 1];
  const prevTrend = d.cashTrend[d.cashTrend.length - 2];
  const trendChange =
    lastTrend && prevTrend ? lastTrend.balance - prevTrend.balance : 0;

  // One renderer per card id (see DASHBOARD_CARDS in @repo/core). A card that
  // doesn't apply to this firm or role renders null. New cards (expiring stock
  // once lots carry an expiry date, for one) are added here and in DASHBOARD_CARDS.
  const cards: Record<DashboardCardId, ReactNode> = {
    balances: (
      <Card
        variant="dark"
        onPress={() => router.navigate("/parties")}
        style={{ flexDirection: "row", gap: space.lg, padding: 20 }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="small" tone="onDarkMute">
            {"To collect"}
          </Txt>
          <Money value={d.toCollect} variant="title" tone="onDark" />
          <Txt variant="caption" tone="onDarkMute">
            {formatText("{n} customers · {m} overdue", {
              n: d.customersWithBalance,
              m: d.overdueCustomers,
            })}
          </Txt>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt variant="small" tone="onDarkMute">
            {"To pay"}
          </Txt>
          <Money value={d.toPay} variant="title" tone="onDark" />
          <Txt variant="caption" tone="onDarkMute">
            {formatText("{n} suppliers", { n: d.suppliersWithBalance })}
          </Txt>
        </View>
      </Card>
    ),
    actions: (
      <ChipRow>
        <Button
          label={"New Sale"}
          icon="plus"
          variant="primary"
          onPress={() => router.push("/sale/new")}
        />
        <Button
          label={"Receive Payment"}
          onPress={() => router.push("/receipt/new")}
        />
        <Button
          label={"Pay Supplier"}
          onPress={() => router.push("/payment/new")}
        />
        <Button
          label={"Add Expense"}
          onPress={() => router.push("/expense/new")}
        />
        <Button label={"Add Party"} onPress={() => router.push("/party/new")} />
        <Button label={"Add Item"} onPress={() => router.push("/item/new")} />
      </ChipRow>
    ),
    cash: (
      <Stat
        label={"Cash in hand"}
        value={formatINR(d.cash)}
        note={"Cash-in-hand ledger"}
      />
    ),
    bank: (
      <Stat
        label={"Bank balances"}
        value={formatINR(d.bankTotal)}
        note={d.banks
          .map(
            (b) =>
              `${b.ledger.shortName.split(" ")[0]} ${formatINR(b.balance, { decimals: false })}`,
          )
          .join(" · ")}
      />
    ),
    "today-sales": (
      <Stat
        label={"Today's sales"}
        value={formatINR(d.todaySales.amount)}
        note={formatText("{n} invoices, incl. GST", {
          n: d.todaySales.count,
        })}
      />
    ),
    "month-sales": (
      <Stat
        label={"This month's net sales"}
        value={formatINR(d.monthSales)}
        note={formatText("Excl. GST, after returns · last month {amount}", {
          amount: formatINR(d.lastMonthSales, { decimals: false }),
        })}
      />
    ),
    gst: d.gst ? (
      <Stat
        label={formatText("GST estimate · {month}", {
          month: monthLabel(d.gst.month),
        })}
        value={formatINR(d.gst.payable)}
        note={`Output ${formatINR(d.gst.output, { decimals: false })} − input ${formatINR(d.gst.input, { decimals: false })}`}
        onPress={() => router.push("/gst")}
      />
    ) : d.composition ? (
      <Stat
        label={formatText("Composition tax · {quarter}", {
          quarter: d.composition.label,
        })}
        value={formatINR(d.composition.tax)}
        note={formatText("{rate}% of {amount} sales", {
          rate: d.composition.rate,
          amount: formatINR(d.composition.turnover, { decimals: false }),
        })}
        onPress={() => router.push("/gst")}
      />
    ) : (
      <Stat
        label={"This month's purchases"}
        value={formatINR(d.monthPurchases)}
        note={"Net of returns"}
        onPress={() => router.push("/purchases")}
      />
    ),
    "low-stock": (
      <Stat
        label={"Low stock"}
        value={formatText("{n} items", { n: d.lowStockCount })}
        note={"Review stock"}
        noteLink
        onPress={() =>
          router.navigate({ pathname: "/items", params: { filter: "low" } })
        }
      />
    ),
    "expiring-stock": (
      <Stat
        label={"Expiring stock"}
        value={formatText("{n} batches", {
          n: d.expiringStock.expired + d.expiringStock.expiring,
        })}
        note={
          d.expiringStock.next
            ? formatText("{expired} expired · next {item} on {date}", {
                expired: d.expiringStock.expired,
                item: d.expiringStock.next.itemName,
                date: formatDate(d.expiringStock.next.expiryDate),
              })
            : d.expiringStock.expired
              ? formatText("{expired} expired", {
                  expired: d.expiringStock.expired,
                })
              : "Nothing expiring in 30 days"
        }
        noteLink
        onPress={() =>
          router.push({
            pathname: "/settings/reports",
            params: { report: "expiring-items" },
          })
        }
      />
    ),
    "itc-at-risk": d.itcAtRisk ? (
      <ItcCard itc={d.itcAtRisk} canPay={canPay} />
    ) : null,
    // In the layout only for roles that may see costs
    "stock-value": (
      <Stat
        label={"Stock value"}
        value={formatINR(d.stockValue)}
        note={"At cost (FIFO) · stock summary"}
        noteLink
        onPress={() => router.push("/reports/stock")}
      />
    ),
    "payables-due": (
      <Stat
        label={"Payables due this week"}
        value={formatINR(d.payablesDue.thisWeek)}
        note={
          d.payablesDue.overdueBills
            ? formatText("{bills} · {amount} already overdue", {
                bills: billCount(d.payablesDue.thisWeekBills),
                amount: formatINR(d.payablesDue.overdue, { decimals: false }),
              })
            : formatText("{bills} · nothing overdue", {
                bills: billCount(d.payablesDue.thisWeekBills),
              })
        }
        onPress={() =>
          router.push({
            pathname: "/reports/outstanding",
            params: { type: "supplier" },
          })
        }
      />
    ),
    "sales-chart": (
      <Card style={{ gap: space.md }}>
        <View>
          <Txt variant="heading">{"Sales vs purchases"}</Txt>
          <Txt variant="small" tone="body">
            {"Last 6 months · excl. GST, after returns"}
          </Txt>
        </View>
        <PairedBarChart
          labels={["Sales", "Purchases"]}
          data={d.salesVsPurchases.map((m) => ({
            label: m.label,
            a: m.sales,
            b: m.purchases,
          }))}
        />
      </Card>
    ),
    "cash-chart": (
      <Card style={{ gap: space.sm }}>
        <View>
          <Txt variant="heading">{"Cash and bank balance"}</Txt>
          <Txt variant="small" tone="body">
            {"Cash + bank at month end"}
          </Txt>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            gap: space.sm,
          }}
        >
          <Money value={lastTrend?.balance ?? 0} variant="title" />
          <Txt variant="small" tone={trendChange >= 0 ? "get" : "give"} num>
            {trendChange >= 0 ? "+" : "−"}
            {formatText("{amount} this month", {
              amount: formatINR(Math.abs(trendChange), { decimals: false }),
            })}
          </Txt>
        </View>
        <LineChart
          data={d.cashTrend.map((m) => ({ label: m.label, value: m.balance }))}
        />
      </Card>
    ),
    "receivables-ageing": <AgeingCard ageing={d.receivablesAgeing} />,
    "top-customers": (
      <TopParties
        title={"Top customers this month"}
        rows={d.topCustomers}
        empty={"No sales yet this month."}
        report={"top-customers"}
      />
    ),
    "top-suppliers": (
      <TopParties
        title={"Top suppliers this month"}
        rows={d.topSuppliers}
        empty={"No purchases yet this month."}
        report={"top-suppliers"}
      />
    ),
    "quiet-customers": <QuietCustomers quiet={d.quietCustomers} />,
    "open-orders": <OpenOrders orders={d.openOrders} />,
    overdue: (
      <View>
        <SectionHeader
          title={"Overdue customers"}
          action={"See all"}
          onAction={() => router.navigate("/parties")}
        />
        {d.topOverdue.length === 0 ? (
          <Txt variant="small" tone="body">
            {"No overdue bills. Nice!"}
          </Txt>
        ) : (
          d.topOverdue.map((o, i) => (
            <View
              key={o.party.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <View style={{ flex: 1 }}>
                <ListRow
                  title={o.party.name}
                  subtitle={
                    <Txt variant="small" tone="warn" num>
                      {formatText("{amount} overdue · {n} days", {
                        amount: formatINR(o.overdueAmount),
                        n: o.maxOverdueDays,
                      })}
                    </Txt>
                  }
                  onPress={() => router.push(`/party/${o.party.id}`)}
                  last={i === d.topOverdue.length - 1}
                />
              </View>
              {canCreate && (
                <Button
                  label={"Remind"}
                  size="sm"
                  onPress={() => sendReminder(o.party.id)}
                />
              )}
            </View>
          ))
        )}
      </View>
    ),
    recent: (
      <View>
        <SectionHeader
          title={"Recent transactions"}
          action={"Day Book"}
          onAction={() => router.push("/daybook")}
        />
        {d.recent.map((v, i) => {
          const badge = voucherBadge(v);
          return (
            <ListRow
              key={v.id}
              left={<Avatar icon={voucherTypeIcon[v.type]} />}
              title={`${voucherTypeLabel[v.type]} · ${v.number}`}
              subtitle={formatDate(v.date)}
              onPress={() => router.push(`/voucher/${v.id}`)}
              right={
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Money
                    value={v.amount}
                    variant="bodyStrong"
                    tone={v.type === "receipt" ? "get" : "ink"}
                    style={
                      v.status === "cancelled" && {
                        textDecorationLine: "line-through",
                        color: colors.body,
                      }
                    }
                  />
                  {badge ? (
                    <Badge label={badge.label} tone={badge.tone} />
                  ) : null}
                </View>
              }
              last={i === d.recent.length - 1}
            />
          );
        })}
      </View>
    ),
    upcoming: (
      <View>
        <SectionHeader title={"Coming up"} />
        {d.upcoming.length === 0 ? (
          <Txt variant="small" tone="body">
            {"Nothing due this week."}
          </Txt>
        ) : (
          d.upcoming.map((u, i) => (
            <ListRow
              key={`${u.title}-${u.date}`}
              left={<Avatar icon="calendar" />}
              title={u.title}
              subtitle={`${formatText("Due {date}", { date: formatDate(u.date) })}${u.amount ? ` · ${formatINR(u.amount)}` : ""}`}
              right={
                <Badge
                  label={
                    u.daysLeft === 0
                      ? "Today"
                      : formatText("{n} days", { n: u.daysLeft })
                  }
                  tone={u.daysLeft <= 3 ? "warn" : "neutral"}
                />
              }
              last={i === d.upcoming.length - 1}
            />
          ))
        )}
      </View>
    ),
  };

  // Wait for the saved layout so hidden cards never flash.
  if (!layout.ready) return null;

  // Figure cards sit two to a row; a wide card ends the row.
  const rows: { key: string; half: boolean; items: ReactNode[] }[] = [];
  for (const slot of layout.slots) {
    const node = slot.visible ? cards[slot.id] : null;
    if (!node) continue;
    const half = DASHBOARD_CARDS[slot.id].size === "half";
    const last = rows[rows.length - 1];
    const item = <Fragment key={slot.id}>{node}</Fragment>;
    if (half && last?.half) last.items.push(item);
    else rows.push({ key: slot.id, half, items: [item] });
  }

  return (
    <>
      {rows.map((row) =>
        row.half ? (
          <View
            key={row.key}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}
          >
            {row.items}
          </View>
        ) : (
          <Fragment key={row.key}>{row.items}</Fragment>
        ),
      )}
      <View style={{ alignItems: "center" }}>
        <Button
          label={"Customise dashboard"}
          icon="sliders"
          size="sm"
          onPress={() => router.push("/settings/dashboard")}
        />
      </View>
    </>
  );
}

const REPORTS_SCREEN = "/settings/reports";

const billCount = (n: number) => formatText("{n} bills", { n });

/** ITC at risk (T26): opens the report; Pay goes to a payment for the supplier with most at risk. */
function ItcCard({
  itc,
  canPay,
}: {
  itc: NonNullable<DashboardData["itcAtRisk"]>;
  canPay: boolean;
}) {
  const note = itc.reverseNowBills
    ? formatText("{bills} past 180 days · reverse {amount}", {
        bills: billCount(itc.reverseNowBills),
        amount: formatINR(itc.reverseNow, { decimals: false }),
      })
    : itc.bills
      ? formatText("{bills} · pay by {date}", {
          bills: billCount(itc.bills),
          date: formatDate(itc.nextLimit ?? ""),
        })
      : "No unpaid bill near the 180-day limit";
  const supplier = itc.topSupplier;
  return (
    <Card style={{ width: "48%", flexGrow: 1, padding: 14, gap: 2 }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={"Open the ITC at risk report"}
        onPress={() =>
          router.push({
            pathname: REPORTS_SCREEN,
            params: { report: "itc-at-risk" },
          })
        }
      >
        <Txt variant="small" tone="body" numberOfLines={1}>
          {"ITC at risk"}
        </Txt>
        <Txt
          variant="heading"
          num
          numberOfLines={1}
          adjustsFontSizeToFit
          tone={itc.reverseNowBills ? "give" : itc.bills ? "warn" : "ink"}
        >
          {formatINR(itc.amount)}
        </Txt>
        <Txt
          variant="caption"
          tone="ink"
          numberOfLines={2}
          style={{ textDecorationLine: "underline" }}
        >
          {note}
        </Txt>
      </Pressable>
      {canPay && supplier ? (
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.push({
              pathname: "/payment/new",
              params: { partyId: supplier.partyId },
            })
          }
          hitSlop={6}
          style={{ marginTop: space.xs }}
        >
          <Txt
            variant="caption"
            tone="give"
            numberOfLines={1}
            style={{ textDecorationLine: "underline" }}
          >
            {formatText("Pay {name}", { name: supplier.name })}
          </Txt>
        </Pressable>
      ) : null}
    </Card>
  );
}

const AGE_LABELS: [keyof DashboardData["receivablesAgeing"], string][] = [
  ["0-30", "Up to 30 days"],
  ["31-60", "31-60 days"],
  ["61-90", "61-90 days"],
  ["90+", "Over 90 days"],
];

function AgeingCard({
  ageing,
}: {
  ageing: DashboardData["receivablesAgeing"];
}) {
  const largest = Math.max(...Object.values(ageing), 1);
  return (
    <View>
      <SectionHeader
        title={"Receivables by age"}
        action={"See all"}
        onAction={() =>
          router.push({
            pathname: "/reports/outstanding",
            params: { type: "customer" },
          })
        }
      />
      {AGE_LABELS.map(([key, label]) => (
        <BarRow
          key={key}
          title={label}
          value={formatINR(ageing[key])}
          share={ageing[key] / largest}
        />
      ))}
    </View>
  );
}

function TopParties({
  title,
  rows,
  empty,
  report,
}: {
  title: string;
  rows: DashboardData["topCustomers"];
  empty: string;
  report: "top-customers" | "top-suppliers";
}) {
  const largest = Math.max(...rows.map((r) => r.value), 1);
  return (
    <View>
      <SectionHeader
        title={title}
        action={"Report"}
        onAction={() =>
          router.push({ pathname: REPORTS_SCREEN, params: { report } })
        }
      />
      {rows.length === 0 ? (
        <Txt variant="small" tone="body">
          {empty}
        </Txt>
      ) : (
        rows.map((r) => (
          <BarRow
            key={r.partyId}
            title={r.name}
            subtitle={billCount(r.bills)}
            value={formatINR(r.value)}
            share={r.value / largest}
            onPress={() => router.push(`/party/${r.partyId}`)}
          />
        ))
      )}
    </View>
  );
}

function QuietCustomers({ quiet }: { quiet: DashboardData["quietCustomers"] }) {
  return (
    <View>
      <SectionHeader
        title={
          quiet.count
            ? formatText("Customers gone quiet · {n}", { n: quiet.count })
            : "Customers gone quiet"
        }
        action={"Report"}
        onAction={() =>
          router.push({
            pathname: REPORTS_SCREEN,
            params: { report: "customer-tracking" },
          })
        }
      />
      {quiet.rows.length === 0 ? (
        <Txt variant="small" tone="body">
          {"Every customer bought in the last 90 days."}
        </Txt>
      ) : (
        quiet.rows.map((q, i) => (
          <ListRow
            key={q.partyId}
            title={q.name}
            subtitle={formatText("Last sale {date} · {n} days ago", {
              date: formatDate(q.lastSale),
              n: q.daysSince,
            })}
            right={
              q.balance > 0 ? (
                <Money value={q.balance} variant="small" tone="get" />
              ) : undefined
            }
            onPress={() => router.push(`/party/${q.partyId}`)}
            last={i === quiet.rows.length - 1}
          />
        ))
      )}
    </View>
  );
}

function OpenOrders({ orders }: { orders: DashboardData["openOrders"] }) {
  const open = orders.filter((o) => o.count > 0);
  return (
    <View>
      <SectionHeader
        title={"Open estimates and orders"}
        action={"All orders"}
        onAction={() => router.push("/orders")}
      />
      {open.length === 0 ? (
        <Txt variant="small" tone="body">
          {"Nothing open. Estimates and orders not yet billed show here."}
        </Txt>
      ) : (
        open.map((o, i) => (
          <ListRow
            key={o.type}
            left={<Avatar icon={voucherTypeIcon[o.type]} />}
            title={voucherTypeLabel[o.type]}
            subtitle={formatText("{n} open", { n: o.count })}
            right={<Money value={o.amount} variant="bodyStrong" />}
            onPress={() =>
              router.push({ pathname: "/orders", params: { type: o.type } })
            }
            last={i === open.length - 1}
          />
        ))
      )}
    </View>
  );
}

/** Small figure card used in the 2-column grid. */
function Stat({
  label,
  value,
  note,
  noteLink,
  onPress,
}: {
  label: string;
  value: string;
  note?: string;
  noteLink?: boolean;
  onPress?: () => void;
}) {
  return (
    <Card onPress={onPress} style={{ width: "48%", flexGrow: 1, padding: 14 }}>
      <Txt variant="small" tone="body" numberOfLines={1}>
        {label}
      </Txt>
      <Txt variant="heading" num numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Txt>
      {note ? (
        <Txt
          variant="caption"
          tone={noteLink ? "ink" : "body"}
          numberOfLines={2}
          style={noteLink && { textDecorationLine: "underline" }}
        >
          {note}
        </Txt>
      ) : null}
    </Card>
  );
}
