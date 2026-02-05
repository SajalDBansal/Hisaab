import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatDate, formatINR } from "@repo/core";
import type { LoanDetail } from "@repo/contracts/src/loans";
import {
  Button,
  EmptyState,
  Header,
  ListRow,
  QueryView,
  Screen,
  Segmented,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useLoan,
  useLoanAccess,
  useLoanHistory,
  useRemoveLoanReference,
} from "@/data/loanHooks";
import { accountHref } from "@/data/labels";
import { space } from "@/theme";

export default function LoanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const access = useLoanAccess();
  const query = useLoan(id);
  return (
    <Screen
      header={<Header title="Loan" />}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      {!access.read ? (
        <EmptyState title="Loan register access denied" />
      ) : !access.connected ? (
        <EmptyState title="Sign in to a connected firm" />
      ) : (
        <QueryView query={query}>
          {(detail) => <LoanContents detail={detail} />}
        </QueryView>
      )}
    </Screen>
  );
}

function LoanContents({ detail }: { detail: LoanDetail }) {
  const { loan, schedule } = detail;
  const access = useLoanAccess();
  const [tab, setTab] = useState<"schedule" | "references" | "history">(
    "schedule",
  );
  const [removal, setRemoval] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const [reason, setReason] = useState("");
  const remove = useRemoveLoanReference(loan.id);
  const history = useLoanHistory(loan.id);
  const removeReference = async () => {
    if (!removal || remove.isPending) return;
    try {
      await remove.mutateAsync({
        referenceId: removal.id,
        version: removal.version,
        reason,
      });
      setRemoval(null);
      setReason("");
    } catch (error) {
      showError("Couldn't remove reference", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="heading">{loan.name}</Txt>
      <Txt>
        {loan.counterparty} | {loan.direction} | {loan.status}
      </Txt>
      {loan.agreementReference ? (
        <Txt>Agreement: {loan.agreementReference}</Txt>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Txt variant="bodyStrong">
          Posted account balance: {formatINR(Math.abs(detail.postedBalance))}{" "}
          {detail.postedBalance < 0 ? "Cr" : "Dr"}
        </Txt>
        <Txt variant="small">
          {detail.accountName} | All books, including opening balance
        </Txt>
        <Txt>Contractual principal: {formatINR(loan.terms.principal)}</Txt>
        <Txt>Planned interest: {formatINR(schedule.totalInterest)}</Txt>
        <Txt>Planned total: {formatINR(schedule.totalRepayment)}</Txt>
        <Txt>Maturity: {formatDate(schedule.maturityDate)}</Txt>
        <Txt variant="small">
          {loan.terms.scheduleModel === "emi-v1" ? "EMI" : "Fixed principal"} |
          Initial rate {loan.terms.annualRateBps / 100}% |{" "}
          {loan.terms.interestBasis ?? "monthly"}. Planned amounts are unposted.
        </Txt>
        <Txt variant="small">
          Valid references: principal {formatINR(detail.referencedPrincipal)},
          interest {formatINR(detail.referencedInterest)}
        </Txt>
      </View>
      {loan.note ? <Txt>{loan.note}</Txt> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <Button
          label="Account statement"
          icon="book-open"
          onPress={() => router.push(accountHref(`account:${loan.accountId}`))}
        />
        <Button
          label="Interest journals"
          icon="percent"
          onPress={() => router.push(`/settlements?loanId=${loan.id}`)}
        />
        {access.write ? (
          <>
            <Button
              label="Edit loan"
              icon="edit-3"
              onPress={() => router.push(`/loans/new?id=${loan.id}`)}
            />
            <Button
              label="Finance journal"
              icon="plus"
              onPress={() => router.push("/journal/financing")}
            />
            {loan.status === "active" ? (
              <>
                <Button
                  label="Link repayment"
                  icon="link"
                  onPress={() => router.push(`/loans/${loan.id}/reference`)}
                />
                <Button
                  label="Accrue / settle interest"
                  icon="percent"
                  onPress={() =>
                    router.push(`/settlements/interest?loanId=${loan.id}`)
                  }
                />
              </>
            ) : null}
          </>
        ) : null}
      </View>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "schedule", label: "Schedule" },
          { value: "references", label: "References" },
          { value: "history", label: "History" },
        ]}
      />
      {tab === "schedule" ? (
        <View>
          {schedule.installments.map((row) => {
            const refs = detail.references.filter(
              (ref) =>
                ref.installmentNumber === row.number && ref.state === "valid",
            );
            return (
              <ListRow
                key={row.number}
                title={`${row.number}. ${formatDate(row.dueDate)}`}
                subtitle={
                  <View style={{ gap: space.xs }}>
                    <Txt variant="small">
                      Planned principal {formatINR(row.principal)} | Interest{" "}
                      {formatINR(row.interest)}
                    </Txt>
                    <Txt variant="small">
                      Planned total {formatINR(row.total)} | Closing principal{" "}
                      {formatINR(row.closingPrincipal)}
                    </Txt>
                    {row.rateSegments?.map((segment, index) => (
                      <Txt key={index} variant="caption">
                        {formatDate(segment.from)} to {formatDate(segment.to)} |{" "}
                        {segment.annualRateBps / 100}%
                      </Txt>
                    ))}
                    {refs.length ? (
                      <Txt variant="caption">
                        Referenced principal{" "}
                        {formatINR(refs.reduce((s, r) => s + r.principal, 0))} |
                        Interest{" "}
                        {formatINR(refs.reduce((s, r) => s + r.interest, 0))}
                      </Txt>
                    ) : null}
                  </View>
                }
              />
            );
          })}
        </View>
      ) : tab === "references" ? (
        <View style={{ gap: space.md }}>
          {detail.references.length ? (
            detail.references.map((ref) => (
              <View key={ref.id}>
                <ListRow
                  title={`${ref.voucherNumber} | ${ref.state}`}
                  onPress={() => router.push(`/voucher/${ref.voucherId}`)}
                  subtitle={
                    <View style={{ gap: space.xs }}>
                      <Txt variant="small">
                        Installment {ref.installmentNumber} |{" "}
                        {formatDate(ref.voucherDate)}
                      </Txt>
                      <Txt variant="small">
                        Principal {formatINR(ref.principal)} | Total referenced
                        interest {formatINR(ref.interest)}
                      </Txt>
                      {ref.sourceValues ? (
                        <Txt variant="caption">
                          Previously accrued interest settled{" "}
                          {formatINR(ref.sourceValues.settledInterest)} |
                          Separately expensed interest{" "}
                          {formatINR(ref.sourceValues.separatelyPostedInterest)}
                        </Txt>
                      ) : null}
                      {ref.note ? (
                        <Txt variant="caption">{ref.note}</Txt>
                      ) : null}
                      {!["valid", "removed"].includes(ref.state) ? (
                        <Txt tone="give" variant="small">
                          Journal requires review; excluded from referenced
                          totals.
                        </Txt>
                      ) : null}
                    </View>
                  }
                />
                {access.write && ref.state !== "removed" ? (
                  <Button
                    label="Remove reference"
                    icon="x"
                    onPress={() => {
                      setRemoval({ id: ref.id, version: loan.version });
                      setReason("");
                    }}
                  />
                ) : null}
              </View>
            ))
          ) : (
            <EmptyState title="No repayment references" />
          )}
          {removal ? (
            <View style={{ gap: space.sm }}>
              <TextField
                label="Removal reason"
                value={reason}
                onChangeText={setReason}
                maxLength={500}
              />
              <Button
                label="Confirm removal"
                icon="check"
                loading={remove.isPending}
                disabled={reason.trim().length < 3}
                onPress={removeReference}
              />
              <Button
                label="Cancel"
                icon="x"
                onPress={() => setRemoval(null)}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <QueryView query={history}>
          {(events) => (
            <View>
              {events.map((event) => (
                <ListRow
                  key={event.id}
                  title={event.action.replaceAll("-", " ")}
                  subtitle={
                    <View>
                      <Txt variant="small">{event.reason}</Txt>
                      <Txt variant="caption">
                        {event.userName} | {new Date(event.at).toLocaleString()}
                      </Txt>
                    </View>
                  }
                />
              ))}
            </View>
          )}
        </QueryView>
      )}
    </View>
  );
}
