import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  formatDate,
  formatINR,
  parseRupees,
  today,
  type CustomAccount,
} from "@repo/core";
import type { LoanDetail } from "@repo/contracts/src/loans";
import {
  LoanInterestInput,
  type SettlementRecord,
} from "@repo/contracts/src/settlements";
import {
  AmountField,
  Button,
  Checkbox,
  DateField,
  EmptyState,
  Header,
  PickerSheet,
  QueryView,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useLoan, useLoans } from "@/data/loanHooks";
import { useAccountMasters, useLedgers } from "@/data/queries";
import {
  usePostLoanInterest,
  useSettlementAccess,
  useSettlements,
} from "@/data/settlementHooks";
import { space } from "@/theme";

export default function LoanInterest() {
  const params = useLocalSearchParams<{ loanId?: string }>();
  const [loanId, setLoan] = useState(params.loanId ?? ""),
    [picker, setPicker] = useState(false);
  const access = useSettlementAccess(),
    list = useLoans(),
    query = useLoan(loanId),
    accounts = useAccountMasters(),
    entries = useSettlements();
  return (
    <Screen header={<Header close title="Loan interest" />}>
      {!access.write || !access.connected ? (
        <EmptyState title="Connected owner or accountant required" />
      ) : (
        <>
          <QueryView query={list}>
            {(rows) => (
              <>
                <SelectField
                  label="Loan"
                  value={rows.find((r) => r.loan.id === loanId)?.loan.name}
                  onPress={() => setPicker(true)}
                />
                <PickerSheet
                  visible={picker}
                  title="Loan"
                  options={rows
                    .filter((r) => r.loan.status === "active")
                    .map((r) => ({ id: r.loan.id, title: r.loan.name }))}
                  onClose={() => setPicker(false)}
                  onSelect={(id) => {
                    setLoan(id);
                    setPicker(false);
                  }}
                />
              </>
            )}
          </QueryView>
          {loanId ? (
            <QueryView query={query}>
              {(detail) => (
                <QueryView query={accounts}>
                  {(rows) => (
                    <QueryView query={entries}>
                      {(history) => (
                        <InterestForm
                          key={loanId}
                          detail={detail}
                          accounts={rows}
                          entries={history}
                        />
                      )}
                    </QueryView>
                  )}
                </QueryView>
              )}
            </QueryView>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function InterestForm({
  detail,
  accounts,
  entries,
}: {
  detail: LoanDetail;
  accounts: CustomAccount[];
  entries: SettlementRecord[];
}) {
  const [original] = useState(detail),
    [kind, setKind] = useState<
      "loan-interest-accrual" | "loan-interest-payment"
    >("loan-interest-accrual");
  const [installmentNumber, setInstallment] = useState(1),
    [accountId, setAccount] = useState(""),
    [ledgerId, setLedger] = useState("");
  const [sourceEntryId, setSource] = useState(""),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [bookScope, setScope] = useState<"gst" | "nongst">("nongst");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [picker, setPicker] = useState<
      "installment" | "account" | "ledger" | "accrual" | null
    >(null);
  const ledgers = useLedgers(),
    save = usePostLoanInterest();
  const planned = original.schedule.installments.find(
    (i) => i.number === installmentNumber,
  );
  const reversed = new Set(
    entries.filter((e) => e.kind === "reversal").map((e) => e.sourceEntryId),
  );
  const unpaid = (entry: SettlementRecord) =>
    entry.amount -
    entries
      .filter(
        (e) =>
          e.kind === "loan-interest-payment" &&
          e.sourceEntryId === entry.id &&
          !reversed.has(e.id),
      )
      .reduce((total, e) => total + e.amount, 0);
  const accruals = entries.filter(
    (e) =>
      e.loanId === original.loan.id &&
      e.kind === "loan-interest-accrual" &&
      !reversed.has(e.id) &&
      unpaid(e) > 0,
  );
  const eligibleAccounts = accounts.filter(
    (a) =>
      a.group ===
      (original.loan.direction === "borrowed"
        ? "Other Current Liabilities"
        : "Other Current Assets"),
  );
  const parsed = LoanInterestInput.safeParse({
    kind,
    loanId: original.loan.id,
    loanVersion: original.loan.version,
    installmentNumber,
    interestAccountId: accountId,
    amount: parseRupees(amount),
    date,
    bookScope,
    reason,
    confirmedNoDuplicate: confirmed,
    ...(kind === "loan-interest-payment" ? { ledgerId, sourceEntryId } : {}),
  });
  const options =
    picker === "installment"
      ? original.schedule.installments.map((i) => ({
          id: String(i.number),
          title: `${i.number}. ${formatDate(i.dueDate)}`,
          subtitle: formatINR(i.interest),
        }))
      : picker === "account"
        ? eligibleAccounts.map((a) => ({ id: a.id, title: a.name }))
        : picker === "ledger"
          ? (ledgers.data ?? []).map((l) => ({
              id: l.ledger.id,
              title: l.ledger.name,
            }))
          : accruals.map((e) => ({
              id: e.id,
              title: `${e.installmentNumber}. ${formatDate(e.date)}`,
              subtitle: `Unpaid ${formatINR(unpaid(e))}`,
            }));
  const submit = async () => {
    if (!parsed.success || save.isPending) return;
    try {
      const entry = await save.mutateAsync(parsed.data);
      router.replace(`/settlements/${entry.id}`);
    } catch (error) {
      showError("Couldn't post interest", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Segmented
        value={kind}
        onChange={(value) => {
          setKind(value);
          setConfirmed(false);
        }}
        options={[
          { value: "loan-interest-accrual", label: "Accrue" },
          { value: "loan-interest-payment", label: "Pay / recover" },
        ]}
      />
      {kind === "loan-interest-accrual" ? (
        <SelectField
          label="Contractual installment"
          value={
            planned ? `${planned.number}. ${formatDate(planned.dueDate)}` : ""
          }
          onPress={() => setPicker("installment")}
        />
      ) : (
        <SelectField
          label="Posted accrual"
          value={accruals.find((e) => e.id === sourceEntryId)?.reason}
          onPress={() => setPicker("accrual")}
        />
      )}
      <Txt>
        Planned interest {formatINR(planned?.interest ?? 0)} | Principal account{" "}
        {formatINR(original.postedBalance)}
      </Txt>
      <SelectField
        label="Separate accrued-interest account"
        value={accounts.find((a) => a.id === accountId)?.name}
        onPress={() => setPicker("account")}
      />
      {kind === "loan-interest-payment" ? (
        <QueryView query={ledgers}>
          {(rows) => (
            <SelectField
              label="Cash / bank"
              value={rows.find((l) => l.ledger.id === ledgerId)?.ledger.name}
              onPress={() => setPicker("ledger")}
            />
          )}
        </QueryView>
      ) : null}
      <AmountField
        label="Confirmed actual interest"
        value={amount}
        onChangeText={(text) => {
          setAmount(text);
          setConfirmed(false);
        }}
      />
      <Segmented
        value={bookScope}
        onChange={(value) => {
          setScope(value);
          setConfirmed(false);
        }}
        options={[
          { value: "gst", label: "GST" },
          { value: "nongst", label: "Non-GST" },
        ]}
      />
      <DateField value={date} onChange={setDate} max={today()} />
      <TextField
        label="Statement / agreement reference and reason"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
      />
      <Checkbox
        label="I checked the actual period and amount; this does not duplicate interest already posted"
        checked={confirmed}
        onChange={setConfirmed}
      />
      <Button
        label="Post interest journal"
        icon="check"
        variant="primary"
        disabled={!parsed.success}
        loading={save.isPending}
        onPress={submit}
      />
      <PickerSheet
        visible={picker !== null}
        title="Select"
        options={options}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "installment") setInstallment(Number(id));
          else if (picker === "account") setAccount(id);
          else if (picker === "ledger") setLedger(id);
          else {
            const entry = accruals.find((e) => e.id === id);
            if (entry) {
              setSource(entry.id);
              setAccount(entry.interestAccountId ?? "");
              setInstallment(entry.installmentNumber ?? 1);
              setScope(entry.bookScope);
            }
          }
          setConfirmed(false);
          setPicker(null);
        }}
      />
    </View>
  );
}
