import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  addDays,
  formatINR,
  parseRupees,
  today,
  type CustomAccount,
} from "@repo/core";
import {
  LoanInput,
  LoanUpdate,
  type LoanDetail,
} from "@repo/contracts/src/loans";
import {
  loanSchedule,
  type LoanScheduleTerms,
} from "@repo/core/src/accounting/loanSchedule";
import {
  AmountField,
  Button,
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
import { useAccountMasters } from "@/data/queries";
import {
  useCreateLoan,
  useLoan,
  useLoanAccess,
  useUpdateLoan,
} from "@/data/loanHooks";
import { space } from "@/theme";
import { useSettlements } from "@/data/settlementHooks";

const models = [
  { id: "fixed-principal-v2", title: "Fixed principal" },
  { id: "emi-v1", title: "EMI" },
  { id: "fixed-principal-monthly-v1", title: "Legacy fixed principal" },
] as const;
const bases = [
  { id: "monthly", title: "Equal monthly periods" },
  { id: "actual-365", title: "Actual / 365" },
  { id: "actual-360", title: "Actual / 360" },
] as const;
const parseRate = (rate: string) =>
  /^\d+(\.\d{1,2})?$/.test(rate) ? Math.round(Number(rate) * 100) : -1;

export default function LoanEditor() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const access = useLoanAccess();
  const query = useLoan(id);
  return (
    <Screen
      header={<Header close title={id ? "Edit loan" : "Register loan"} />}
    >
      {!access.write ? (
        <EmptyState title="Only owners and accountants can edit loans" />
      ) : !access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : id ? (
        <QueryView query={query}>
          {(detail) => <EditorAccounts detail={detail} />}
        </QueryView>
      ) : (
        <EditorAccounts />
      )}
    </Screen>
  );
}

function EditorAccounts({ detail }: { detail?: LoanDetail }) {
  const accounts = useAccountMasters();
  return (
    <QueryView query={accounts}>
      {(rows) => (
        <LoanForm
          key={detail?.loan.id ?? "new"}
          accounts={rows}
          detail={detail}
        />
      )}
    </QueryView>
  );
}

function LoanForm({
  accounts,
  detail,
}: {
  accounts: CustomAccount[];
  detail?: LoanDetail;
}) {
  // Keep the version from when the form opened; background refreshes must not erase a conflict.
  const [original] = useState(detail);
  const loan = original?.loan;
  const create = useCreateLoan();
  const update = useUpdateLoan(loan?.id ?? "");
  const interest = useSettlements();
  const [name, setName] = useState(loan?.name ?? "");
  const [counterparty, setCounterparty] = useState(loan?.counterparty ?? "");
  const [agreementReference, setReference] = useState(
    loan?.agreementReference ?? "",
  );
  const [note, setNote] = useState(loan?.note ?? "");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"borrowed" | "lent">(
    loan?.direction ?? "borrowed",
  );
  const [status, setStatus] = useState<"active" | "closed">(
    loan?.status ?? "active",
  );
  const [accountId, setAccountId] = useState(loan?.accountId ?? "");
  const [principalText, setPrincipal] = useState(
    loan ? (loan.terms.principal / 100).toFixed(2) : "",
  );
  const [rate, setRate] = useState(
    loan ? (loan.terms.annualRateBps / 100).toFixed(2) : "0",
  );
  const [count, setCount] = useState(String(loan?.terms.installments ?? 12));
  const [startDate, setStartDate] = useState(loan?.terms.startDate ?? today());
  const [firstDueDate, setFirstDueDate] = useState(
    loan?.terms.firstDueDate ?? addDays(today(), 30),
  );
  const [model, setModel] = useState<LoanScheduleTerms["scheduleModel"]>(
    loan?.terms.scheduleModel ?? "fixed-principal-v2",
  );
  const [interestBasis, setBasis] = useState<
    NonNullable<LoanScheduleTerms["interestBasis"]>
  >(loan?.terms.interestBasis ?? "monthly");
  const [rateChanges, setRateChanges] = useState(
    (loan?.terms.rateChanges ?? []).map((r) => ({
      effectiveDate: r.effectiveDate,
      rate: (r.annualRateBps / 100).toFixed(2),
    })),
  );
  const [picker, setPicker] = useState<"account" | "model" | "basis" | null>(
    null,
  );
  const interestRows = (interest.data ?? []).filter(
    (e) => e.loanId === loan?.id,
  );
  const frozen = !!original?.references.length || interestRows.length > 0;
  const protectedInstallments = new Set([
    ...(original?.references ?? []).map((r) => r.installmentNumber),
    ...interestRows.flatMap((e) =>
      e.installmentNumber ? [e.installmentNumber] : [],
    ),
  ]);
  const protectedThrough = (original?.schedule.installments ?? [])
    .filter((r) => protectedInstallments.has(r.number))
    .reduce((date, r) => (r.dueDate > date ? r.dueDate : date), today());
  const candidates = accounts.filter((a) =>
    direction === "lent"
      ? a.group === "Loans & Advances (Asset)"
      : ["Secured Loans", "Unsecured Loans"].includes(a.group),
  );
  const parsed = LoanInput.safeParse({
    name,
    counterparty,
    agreementReference,
    note,
    accountId,
    direction,
    terms: {
      principal: parseRupees(principalText),
      annualRateBps: parseRate(rate),
      installments: /^\d+$/.test(count) ? Number(count) : 0,
      startDate,
      firstDueDate,
      scheduleModel: model,
      ...(model !== "fixed-principal-monthly-v1"
        ? {
            interestBasis,
            rateChanges: rateChanges.map((r) => ({
              effectiveDate: r.effectiveDate,
              annualRateBps: parseRate(r.rate),
            })),
          }
        : {
            ...(loan?.terms.interestBasis
              ? { interestBasis: loan.terms.interestBasis }
              : {}),
            ...(loan?.terms.rateChanges
              ? { rateChanges: loan.terms.rateChanges }
              : {}),
          }),
    },
  });
  const preview = parsed.success ? loanSchedule(parsed.data.terms) : null;
  const busy = create.isPending || update.isPending;
  const save = async () => {
    if (!parsed.success || busy) return;
    try {
      const saved = loan
        ? await update.mutateAsync({
            version: loan.version,
            data: LoanUpdate.parse({ ...parsed.data, status, reason }),
          })
        : await create.mutateAsync(parsed.data);
      router.replace(`/loans/${saved.id}`);
    } catch (error) {
      showError("Couldn't save loan", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <TextField
        label="Loan name"
        value={name}
        onChangeText={setName}
        maxLength={150}
      />
      <TextField
        label="Counterparty"
        value={counterparty}
        onChangeText={setCounterparty}
        maxLength={150}
      />
      {!loan ? (
        <Segmented
          value={direction}
          onChange={(v) => {
            setDirection(v);
            setAccountId("");
          }}
          options={[
            { value: "borrowed", label: "Borrowed" },
            { value: "lent", label: "Lent" },
          ]}
        />
      ) : (
        <Txt>{direction === "borrowed" ? "Borrowed" : "Lent"}</Txt>
      )}
      {!loan ? (
        <>
          <SelectField
            label="Dedicated loan account"
            value={accounts.find((a) => a.id === accountId)?.name}
            onPress={() => setPicker("account")}
          />
          <Button
            label="New account"
            icon="plus"
            onPress={() => router.push("/account/new")}
          />
        </>
      ) : (
        <Txt>{original.accountName}</Txt>
      )}
      <TextField
        label="Agreement reference"
        value={agreementReference}
        onChangeText={setReference}
        maxLength={150}
      />
      <AmountField
        label="Contractual principal (Rs)"
        value={principalText}
        onChangeText={setPrincipal}
        editable={!frozen}
      />
      <TextField
        label="Annual interest (%)"
        value={rate}
        onChangeText={setRate}
        keyboardType="decimal-pad"
        editable={!frozen}
      />
      {frozen ? (
        <Txt>
          {models.find((m) => m.id === model)?.title} |{" "}
          {bases.find((b) => b.id === interestBasis)?.title}
        </Txt>
      ) : (
        <>
          <SelectField
            label="Repayment model"
            value={models.find((m) => m.id === model)?.title}
            onPress={() => setPicker("model")}
          />
          {model !== "fixed-principal-monthly-v1" ? (
            <SelectField
              label="Interest basis"
              value={bases.find((b) => b.id === interestBasis)?.title}
              onPress={() => setPicker("basis")}
            />
          ) : null}
        </>
      )}
      <TextField
        label="Monthly installments"
        value={count}
        onChangeText={setCount}
        keyboardType="number-pad"
        editable={!frozen}
      />
      {frozen ? (
        <Txt>
          Start {startDate} | First repayment {firstDueDate}
        </Txt>
      ) : (
        <>
          <DateField
            label="Loan start date"
            value={startDate}
            onChange={setStartDate}
          />
          <DateField
            label="First repayment date"
            value={firstDueDate}
            onChange={setFirstDueDate}
          />
        </>
      )}
      {model !== "fixed-principal-monthly-v1" ? (
        <View style={{ gap: space.md }}>
          <Txt variant="bodyStrong">Contractual rate changes</Txt>
          {rateChanges.map((change, index) => {
            const locked = frozen && change.effectiveDate <= protectedThrough;
            return (
              <View key={index} style={{ gap: space.sm }}>
                {locked ? (
                  <Txt>{change.effectiveDate}</Txt>
                ) : (
                  <DateField
                    label="Effective date"
                    value={change.effectiveDate}
                    min={
                      frozen
                        ? addDays(protectedThrough, 1)
                        : addDays(startDate, 1)
                    }
                    onChange={(effectiveDate) =>
                      setRateChanges((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, effectiveDate } : r,
                        ),
                      )
                    }
                  />
                )}
                <TextField
                  label="Annual rate (%)"
                  value={change.rate}
                  keyboardType="decimal-pad"
                  editable={!locked}
                  onChangeText={(rate) =>
                    setRateChanges((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, rate } : r)),
                    )
                  }
                />
                {!locked ? (
                  <Button
                    label="Remove rate change"
                    icon="x"
                    onPress={() =>
                      setRateChanges((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                  />
                ) : null}
              </View>
            );
          })}
          <Button
            label="Add rate change"
            icon="plus"
            disabled={rateChanges.length >= 600}
            onPress={() =>
              setRateChanges((rows) => {
                const minimum = frozen ? protectedThrough : startDate;
                const last = rows[rows.length - 1];
                return [
                  ...rows,
                  {
                    effectiveDate: addDays(
                      last && last.effectiveDate > minimum
                        ? last.effectiveDate
                        : minimum,
                      1,
                    ),
                    rate: last?.rate ?? rate,
                  },
                ];
              })
            }
          />
        </View>
      ) : null}
      {preview ? (
        <Txt>
          Planned interest {formatINR(preview.totalInterest)} | Planned total{" "}
          {formatINR(preview.totalRepayment)} | Maturity {preview.maturityDate}
          {model === "emi-v1"
            ? ` | First installment ${formatINR(preview.installments[0]!.total)}`
            : ""}
        </Txt>
      ) : null}
      <TextField
        label="Note"
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={1000}
      />
      {loan ? (
        <>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: "active", label: "Active" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <TextField
            label="Reason for change"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
        </>
      ) : null}
      {!parsed.success ? (
        <Txt variant="caption" tone="give">
          {parsed.error.issues[0]?.message}
        </Txt>
      ) : null}
      <Button
        label="Save loan"
        icon="check"
        variant="primary"
        loading={busy}
        disabled={
          !parsed.success || (loan !== undefined && reason.trim().length < 3)
        }
        onPress={save}
      />
      <PickerSheet
        visible={picker !== null}
        title={
          picker === "model"
            ? "Repayment model"
            : picker === "basis"
              ? "Interest basis"
              : "Loan account"
        }
        options={
          picker === "model"
            ? models.filter(
                (m) =>
                  m.id !== "fixed-principal-monthly-v1" ||
                  loan?.terms.scheduleModel === m.id,
              )
            : picker === "basis"
              ? [...bases]
              : candidates.map((a) => ({
                  id: a.id,
                  title: a.name,
                  subtitle: a.group,
                }))
        }
        onSelect={(id) => {
          if (picker === "model") {
            const selected = models.find((m) => m.id === id);
            if (selected) setModel(selected.id);
          } else if (picker === "basis") {
            const selected = bases.find((b) => b.id === id);
            if (selected) setBasis(selected.id);
          } else setAccountId(id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
