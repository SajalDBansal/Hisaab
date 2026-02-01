import { formatText } from "@/data/text";
import { Redirect, router } from "expo-router";
import { FirmDetail } from "@repo/contracts";
import { REQUIRE_LOGIN } from "@/auth/config";
import { View } from "react-native";
import {
  formatDate,
  formatINR,
  monthLabel,
  type DashboardData,
} from "@repo/core";
import {
  Avatar,
  Badge,
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
import { voucherBadge, voucherTypeIcon, voucherTypeLabel } from "@/data/labels";

import { useSendReminder } from "@/data/share";
import { colors, space } from "@/theme";

/** Home dashboard. All figures come from reportService.dashboard() (see @repo/core). */
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

  const lastTrend = d.cashTrend[d.cashTrend.length - 1];
  const prevTrend = d.cashTrend[d.cashTrend.length - 2];
  const trendChange =
    lastTrend && prevTrend ? lastTrend.balance - prevTrend.balance : 0;

  return (
    <>
      {/* The one dark card on this screen */}
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

      {canCreate && (
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
          <Button
            label={"Add Party"}
            onPress={() => router.push("/party/new")}
          />
          <Button label={"Add Item"} onPress={() => router.push("/item/new")} />
        </ChipRow>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
        <Stat
          label={"Cash in hand"}
          value={formatINR(d.cash)}
          note={"Cash-in-hand ledger"}
        />
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
        <Stat
          label={"Today's sales"}
          value={formatINR(d.todaySales.amount)}
          note={formatText("{n} invoices", { n: d.todaySales.count })}
        />
        <Stat
          label={"This month's sales"}
          value={formatINR(d.monthSales)}
          note={formatText("Last month {amount}", {
            amount: formatINR(d.lastMonthSales, { decimals: false }),
          })}
        />
        {d.gst ? (
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
            note={"Purchase bills"}
            onPress={() => router.push("/purchases")}
          />
        )}
        <Stat
          label={"Low stock"}
          value={formatText("{n} items", { n: d.lowStockCount })}
          note={"Review stock"}
          noteLink
          onPress={() =>
            router.navigate({ pathname: "/items", params: { filter: "low" } })
          }
        />
      </View>

      <Card style={{ gap: space.md }}>
        <View>
          <Txt variant="heading">{"Sales vs purchases"}</Txt>
          <Txt variant="small" tone="body">
            {"Last 6 months"}
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
    </>
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
