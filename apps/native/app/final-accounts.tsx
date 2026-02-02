import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  formatINR,
  periodRange,
  type PeriodKey,
  type FinalAccounts,
  type StatementLine,
  type TrialBalance,
} from "@repo/core";
import {
  Badge,
  Card,
  Header,
  Money,
  Notice,
  QueryView,
  Screen,
  TaxScopeFilter,
  PeriodChips,
  Segmented,
  TableRow,
  Txt,
} from "@/components";
import { accountHref } from "@/data/labels";
import { useFinalAccounts, useFirm, useTrialBalance } from "@/data/queries";
import { colors, radius, space } from "@/theme";

type Tab = "tb" | "pl" | "bs";

const box = {
  borderWidth: 1,
  borderColor: colors.hairline,
  borderRadius: radius.card,
  overflow: "hidden" as const,
};

/** Trial balance, profit & loss and balance sheet in one place. */
export default function FinalAccountsScreen() {
  const params = useLocalSearchParams<{ view?: Tab }>();
  const [view, setView] = useState<Tab>(params.view ?? "pl");
  useFirm();
  const tb = useTrialBalance();
  const [period, setPeriod] = useState<PeriodKey>("fy");
  const range = periodRange(period);
  const final = useFinalAccounts(
    view === "pl" ? range.from : undefined,
    view === "pl" ? range.to : undefined,
  );

  return (
    <Screen
      header={
        <Header
          title="Final accounts"
          subtitle={
            view === "pl" ? `${range.from} to ${range.to}` : "As at today"
          }
        />
      }
      onRefresh={() => {
        tb.refetch();
        final.refetch();
      }}
      refreshing={tb.isRefetching || final.isRefetching}
    >
      <TaxScopeFilter />
      {view === "pl" ? (
        <PeriodChips value={period} onChange={setPeriod} />
      ) : null}
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: "tb", label: "Trial balance" },
          { value: "pl", label: "Profit & loss" },
          { value: "bs", label: "Balance sheet" },
        ]}
      />
      {view === "tb" ? (
        <QueryView query={tb}>{(t) => <TrialBalanceView tb={t} />}</QueryView>
      ) : (
        <QueryView query={final}>
          {(f) =>
            view === "pl" ? <ProfitLoss f={f} /> : <BalanceSheet f={f} />
          }
        </QueryView>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function TrialBalanceView({ tb }: { tb: TrialBalance }) {
  const agrees = tb.totalDebit === tb.totalCredit;
  let lastGroup = "";
  return (
    <>
      {agrees ? (
        <Notice tone="info" text="Debit and credit totals agree." />
      ) : (
        <Notice
          text={`Totals differ by ${formatINR(Math.abs(tb.totalDebit - tb.totalCredit))}. Check recent entries.`}
        />
      )}
      <View style={box}>
        <TableRow header cells={["Account", "Debit", "Credit"]} />
        {tb.rows.map((r) => {
          const showGroup = r.group !== lastGroup;
          lastGroup = r.group;
          return (
            <View key={r.key}>
              {showGroup ? (
                <View
                  style={{
                    paddingHorizontal: 12,
                    paddingTop: 10,
                    paddingBottom: 2,
                  }}
                >
                  <Txt variant="caption" tone="body">
                    {r.group}
                  </Txt>
                </View>
              ) : null}
              <TableRow
                cells={[
                  r.name,
                  r.debit ? formatINR(r.debit) : "",
                  r.credit ? formatINR(r.credit) : "",
                ]}
                onPress={() => router.push(accountHref(r.key))}
              />
            </View>
          );
        })}
        <TableRow
          strong
          last
          cells={["Total", formatINR(tb.totalDebit), formatINR(tb.totalCredit)]}
        />
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------

/** "Label ........ ₹amount" line, optionally tappable. */
function Line({
  label,
  amount,
  strong,
  minus,
  accountKey,
  last,
}: {
  label: string;
  amount: number;
  strong?: boolean;
  minus?: boolean;
  accountKey?: string;
  last?: boolean;
}) {
  return (
    <TableRow
      width={120}
      strong={strong}
      last={last}
      cells={[
        label,
        // A negative amount on a "less" line (e.g. round-off gained) shows as a plus
        `${(minus ? amount > 0 : amount < 0) ? "− " : ""}${formatINR(Math.abs(amount))}`,
      ]}
      onPress={
        accountKey ? () => router.push(accountHref(accountKey)) : undefined
      }
    />
  );
}

function Lines({ lines, minus }: { lines: StatementLine[]; minus?: boolean }) {
  return (
    <>
      {lines.map((l) => (
        <Line
          key={l.key ?? l.name}
          label={l.name}
          amount={l.amount}
          minus={minus}
          accountKey={l.key}
        />
      ))}
    </>
  );
}

function ProfitLoss({ f }: { f: FinalAccounts }) {
  const p = f.profitAndLoss;
  const sum = (ls: StatementLine[]) => ls.reduce((s, l) => s + l.amount, 0);
  const profit = p.netProfit >= 0;
  return (
    <>
      <Card variant="dark" style={{ gap: space.sm }}>
        <Txt variant="small" tone="onDarkMute">
          {profit ? "Net profit" : "Net loss"}
        </Txt>
        <Money value={Math.abs(p.netProfit)} variant="display" tone="onDark" />
        <Txt variant="caption" tone="onDarkMute">
          {p.sales
            ? `${((p.netProfit / p.sales) * 100).toFixed(1)}% of sales · gross margin ${((p.grossProfit / p.sales) * 100).toFixed(1)}%`
            : "No sales yet"}
        </Txt>
      </Card>

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Trading account</Txt>
        <View style={box}>
          <Line label="Sales" amount={p.sales} accountKey="sales" />
          <Line label="Opening stock" amount={p.openingStock} minus />
          <Line
            label="Purchases"
            amount={p.purchases}
            minus
            accountKey="purchase"
          />
          <Lines lines={p.directExpenses} minus />
          <Line label="Add: closing stock" amount={p.closingStock} />
          <Line
            label={p.grossProfit >= 0 ? "Gross profit" : "Gross loss"}
            amount={Math.abs(p.grossProfit)}
            strong
            last
          />
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Profit & loss account</Txt>
        <View style={box}>
          <Line
            label={p.grossProfit >= 0 ? "Gross profit" : "Gross loss"}
            amount={Math.abs(p.grossProfit)}
            minus={p.grossProfit < 0}
          />
          <Lines lines={p.indirectIncomes} />
          <Lines lines={p.indirectExpenses} minus />
          <Line
            label={profit ? "Net profit" : "Net loss"}
            amount={Math.abs(p.netProfit)}
            strong
            last
          />
        </View>
        <Txt variant="caption" tone="body">
          Other income {formatINR(sum(p.indirectIncomes))} · Expenses{" "}
          {formatINR(sum(p.indirectExpenses))}. Stock is valued at purchase
          price.
        </Txt>
      </View>
    </>
  );
}

function BalanceSheet({ f }: { f: FinalAccounts }) {
  const { liabilities, assets, balanced } = f.balanceSheet;
  const Side = ({
    title,
    side,
  }: {
    title: string;
    side: typeof liabilities;
  }) => (
    <View style={{ gap: space.sm }}>
      <Txt variant="heading">{title}</Txt>
      <View style={box}>
        {side.sections.map((s) => (
          <View key={s.title}>
            <TableRow
              header
              width={120}
              cells={[s.title, formatINR(s.total)]}
            />
            {s.lines.map((l) => (
              <Line
                key={l.key ?? l.name}
                label={l.name}
                amount={Math.abs(l.amount)}
                minus={l.amount < 0}
                accountKey={l.key}
              />
            ))}
          </View>
        ))}
        <Line label="Total" amount={side.total} strong last />
      </View>
    </View>
  );
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Badge
          label={balanced ? "Balanced" : "Not balanced"}
          tone={balanced ? "ok" : "bad"}
        />
        <Txt variant="small" tone="body">
          Assets = Capital + Liabilities
        </Txt>
      </View>
      <Side title="Capital & liabilities" side={liabilities} />
      <Side title="Assets" side={assets} />
    </>
  );
}
