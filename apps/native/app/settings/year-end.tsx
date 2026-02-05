import { useState } from "react";
import { View } from "react-native";
import { financialYear, formatDate, formatINR, today } from "@repo/core";
import type { YearEndView } from "@repo/contracts";
import {
  Button,
  Checkbox,
  Header,
  Notice,
  QueryView,
  Screen,
  TaxScopeFilter,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCloseYear, useYearEnd } from "@/data/bookReviewQueries";
import { useReportScope } from "@/data/reportScope";
import { confirmAction } from "@/data/confirm";
import { space, colors } from "@/theme";

export default function YearEndScreen() {
  const currentYear = Number(financialYear(today()).start.slice(0, 4));
  const [year, setYear] = useState(currentYear - 1);
  const query = useYearEnd(year);
  return (
    <Screen
      header={<Header title="Financial year review" />}
      onRefresh={() => query.refetch()}
      refreshing={query.isRefetching}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
      >
        <Button
          label="Previous"
          icon="chevron-left"
          disabled={year <= 1900}
          onPress={() => setYear(year - 1)}
        />
        <Txt variant="bodyStrong" style={{ flex: 1, textAlign: "center" }}>
          {year}-{String(year + 1).slice(-2)}
        </Txt>
        <Button
          label="Next"
          icon="chevron-right"
          disabled={year >= currentYear}
          onPress={() => setYear(year + 1)}
        />
      </View>
      <QueryView query={query}>
        {(view) => (
          <Review
            key={`${view.year}:${view.version}:${view.digest}`}
            view={view}
          />
        )}
      </QueryView>
    </Screen>
  );
}

function Review({ view }: { view: YearEndView }) {
  const [tax, setTax] = useReportScope();
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const close = useCloseYear();
  const selected = view.scopes.find((s) => s.tax === tax)!;
  const save = async () => {
    try {
      await close.mutateAsync({
        year: view.year,
        version: view.version,
        digest: view.digest,
        reason,
      });
    } catch (error) {
      showError("Couldn't close year", error);
    }
  };
  return (
    <>
      <TaxScopeFilter value={tax} onChange={setTax} />
      <Txt variant="small">
        {formatDate(view.from)} to {formatDate(view.to)}
      </Txt>
      {view.blockers.map((text) => (
        <Notice key={text} tone="warn" text={text} />
      ))}
      <Summary
        label="Trial balance debit"
        value={selected.trialBalance.totalDebit}
      />
      <Summary
        label="Trial balance credit"
        value={selected.trialBalance.totalCredit}
      />
      <Summary
        label="Year profit / loss"
        value={selected.finalAccounts.profitAndLoss.netProfit}
      />
      <Summary
        label="Closing assets"
        value={selected.finalAccounts.balanceSheet.assets.total}
      />
      <Summary
        label="Closing capital and liabilities"
        value={selected.finalAccounts.balanceSheet.liabilities.total}
      />
      <Summary
        label="Receivables carried forward"
        value={selected.receivable}
      />
      <Summary label="Payables carried forward" value={selected.payable} />
      <Summary
        label="Stock carried forward"
        value={selected.finalAccounts.profitAndLoss.closingStock}
      />
      <Txt variant="heading">Closing account balances</Txt>
      {selected.trialBalance.rows.map((row) => (
        <Summary
          key={row.key}
          label={row.name}
          value={row.debit - row.credit}
        />
      ))}
      {view.canClose ? (
        <>
          <TextField
            label="Year-end review note"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
          <Checkbox
            label="I approve the GST, non-GST and mixed year-end figures"
            checked={reviewed}
            onChange={setReviewed}
          />
          <Button
            label="Close financial year"
            icon="lock"
            disabled={!reviewed || reason.trim().length < 10 || close.isPending}
            onPress={() =>
              confirmAction(
                "Close this financial year?",
                `Entries through ${formatDate(view.to)} will be locked. Outstanding bills and inventory remain in the same firm for ${formatDate(view.nextFrom)}.`,
                "Close year",
                save,
              )
            }
          />
        </>
      ) : null}
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: space.md,
        paddingVertical: space.sm,
        borderBottomWidth: 1,
        borderBottomColor: colors.hairline,
      }}
    >
      <Txt variant="small" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="small" style={{ flex: 1, textAlign: "right" }}>
        {formatINR(value)}
      </Txt>
    </View>
  );
}
