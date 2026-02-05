import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatDate, formatINR, parseRupees } from "@repo/core";
import type {
  LoanDetail,
  LoanJournalCandidate,
} from "@repo/contracts/src/loans";
import {
  Button,
  Checkbox,
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
import {
  useAddLoanReference,
  useLoan,
  useLoanAccess,
  useLoanCandidates,
} from "@/data/loanHooks";
import { space } from "@/theme";

export default function LoanReferenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const access = useLoanAccess();
  const query = useLoan(id);
  const candidates = useLoanCandidates(id);
  return (
    <Screen header={<Header close title="Link repayment journal" />}>
      {!access.write ? (
        <EmptyState title="Only owners and accountants can link repayments" />
      ) : !access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : (
        <QueryView query={query}>
          {(detail) => (
            <QueryView query={candidates}>
              {(rows) => <ReferenceForm detail={detail} candidates={rows} />}
            </QueryView>
          )}
        </QueryView>
      )}
    </Screen>
  );
}

function ReferenceForm({
  detail,
  candidates,
}: {
  detail: LoanDetail;
  candidates: LoanJournalCandidate[];
}) {
  const [original] = useState(detail);
  const [journal, setJournal] = useState<LoanJournalCandidate | null>(null);
  const [installment, setInstallment] = useState(1);
  const [note, setNote] = useState("");
  const [principalConfirmed, setPrincipalConfirmed] = useState(false);
  const [allocationMode, setAllocationMode] = useState<"principal" | "split">(
    "principal",
  );
  const [principalText, setPrincipalText] = useState("");
  const [settledInterestText, setSettledInterestText] = useState("");
  const [picker, setPicker] = useState<"journal" | "installment" | null>(null);
  const save = useAddLoanReference(original.loan.id);
  const selected = original.schedule.installments.find(
    (row) => row.number === installment,
  )!;
  const principal = parseRupees(principalText) ?? Number.NaN;
  const settledInterest = parseRupees(settledInterestText) ?? Number.NaN;
  const validSplit =
    principalText.trim() !== "" &&
    settledInterestText.trim() !== "" &&
    Number.isSafeInteger(principal) &&
    principal > 0 &&
    Number.isSafeInteger(settledInterest) &&
    settledInterest >= 0 &&
    Number.isSafeInteger(principal + settledInterest) &&
    principal + settledInterest === journal?.accountReduction;
  const ready =
    journal &&
    principalConfirmed &&
    (allocationMode === "principal" || validSplit) &&
    original.loan.status === "active";
  const submit = async () => {
    if (!journal || !ready || save.isPending) return;
    try {
      await save.mutateAsync({
        version: original.loan.version,
        data: {
          voucherId: journal.id,
          voucherVersion: journal.version,
          installmentNumber: installment,
          principalConfirmed: true,
          ...(allocationMode === "split"
            ? {
                allocation: {
                  principal,
                  settledInterest,
                  confirmed: true as const,
                },
              }
            : {}),
          note,
        },
      });
      router.replace(`/loans/${original.loan.id}`);
    } catch (error) {
      showError("Couldn't link repayment", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="heading">{original.loan.name}</Txt>
      {candidates.length ? (
        <SelectField
          label="Posted repayment journal"
          value={journal?.number}
          onPress={() => setPicker("journal")}
        />
      ) : (
        <EmptyState title="No eligible repayment journals" />
      )}
      <Button
        label="Finance journal"
        icon="plus"
        onPress={() => router.push("/journal/financing")}
      />
      {journal ? (
        <>
          <Txt>
            {formatDate(journal.date)} | Account reduction{" "}
            {formatINR(journal.accountReduction)} | Separately expensed interest{" "}
            {formatINR(journal.separatelyPostedInterest)}
          </Txt>
          <Button
            label="Review journal"
            icon="external-link"
            onPress={() => router.push(`/voucher/${journal.id}`)}
          />
          <Segmented
            value={allocationMode}
            onChange={(mode) => {
              setAllocationMode(mode);
              setPrincipalConfirmed(false);
            }}
            options={[
              { value: "principal", label: "All principal" },
              { value: "split", label: "Reviewed split" },
            ]}
          />
          {allocationMode === "split" ? (
            <>
              <TextField
                label="Principal repaid"
                value={principalText}
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setPrincipalText(value);
                  setPrincipalConfirmed(false);
                }}
              />
              <TextField
                label="Previously accrued interest settled"
                value={settledInterestText}
                keyboardType="decimal-pad"
                onChangeText={(value) => {
                  setSettledInterestText(value);
                  setPrincipalConfirmed(false);
                }}
              />
              <Txt variant="small" tone={validSplit ? "mute" : "give"}>
                {validSplit
                  ? `Total referenced interest ${formatINR(settledInterest + journal.separatelyPostedInterest)}`
                  : `Principal must be positive; principal and settled interest must total ${formatINR(journal.accountReduction)}.`}
              </Txt>
            </>
          ) : null}
        </>
      ) : null}
      <SelectField
        label="Scheduled installment"
        value={`${installment}. ${formatDate(selected.dueDate)}`}
        onPress={() => setPicker("installment")}
      />
      <Txt>
        Planned principal {formatINR(selected.principal)} | Planned interest{" "}
        {formatINR(selected.interest)}
      </Txt>
      <TextField
        label="Repayment reference / note"
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <Checkbox
        label={
          allocationMode === "split"
            ? "I reviewed this principal/interest split against the statement; settled interest was previously accrued in the loan account"
            : "The entire loan-account reduction is principal, excluding previously accrued interest"
        }
        checked={principalConfirmed}
        onChange={setPrincipalConfirmed}
      />
      <Button
        label="Link journal"
        icon="link"
        variant="primary"
        disabled={!ready}
        loading={save.isPending}
        onPress={submit}
      />
      <PickerSheet
        visible={picker !== null}
        title={picker === "journal" ? "Repayment journal" : "Installment"}
        options={
          picker === "journal"
            ? candidates.map((row) => ({
                id: row.id,
                title: row.number,
                subtitle: `${formatDate(row.date)} | Reduction ${formatINR(row.accountReduction)} | Interest ${formatINR(row.separatelyPostedInterest)}`,
              }))
            : original.schedule.installments.map((row) => ({
                id: String(row.number),
                title: `${row.number}. ${formatDate(row.dueDate)}`,
                subtitle: formatINR(row.total),
              }))
        }
        onSelect={(id) => {
          if (picker === "journal") {
            setJournal(candidates.find((row) => row.id === id) ?? null);
            setPrincipalConfirmed(false);
            setPrincipalText("");
            setSettledInterestText("");
          } else setInstallment(Number(id));
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
