import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { PendingEntry } from "@repo/contracts";
import { formatDate, formatINR, needsApproval, parseRupees } from "@repo/core";
import {
  AmountField,
  Badge,
  Button,
  Card,
  DateField,
  FooterBar,
  Header,
  KeyValue,
  QueryView,
  Screen,
  SectionHeader,
  TextField,
  Txt,
  showError,
  showToast,
} from "@/components";
import { useData } from "@/data/DataProvider";
import {
  ENTRY_STATUS,
  useApprovalSettings,
  useEntryAction,
  usePendingEntry,
} from "@/data/recurringHooks";
import { voucherTypeLabel } from "@/data/labels";
import { space } from "@/theme";

/** One entry to review: check, change the date or amount, then save, approve or send back. */
export default function EntryScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const entry = usePendingEntry(id);
  return (
    <QueryView query={entry}>
      {(e) => <Review key={e.version} entry={e} />}
    </QueryView>
  );
}

const SINGLE_AMOUNT = ["receipt", "payment", "contra", "expense"];

function Review({ entry }: { entry: PendingEntry }) {
  const { role } = useData();
  const approvals = useApprovalSettings();
  const action = useEntryAction();
  const approver = !!approvals.data?.canApprove;
  const input = entry.input as Record<string, unknown>;
  const editable = entry.status === "draft" || entry.status === "rejected";
  const reviewing = entry.status === "submitted" && approver;
  const [date, setDate] = useState(entry.date);
  const amountEditable =
    (editable || reviewing) &&
    SINGLE_AMOUNT.includes(entry.voucherType) &&
    typeof input.amount === "number" &&
    !input.gst;
  const [amountText, setAmountText] = useState(
    typeof input.amount === "number" ? (input.amount / 100).toFixed(2) : "",
  );
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const waits = needsApproval(
    entry.voucherType,
    approvals.data?.types ?? [],
    role,
  );

  const edited = () => {
    const amount = amountEditable ? parseRupees(amountText) : undefined;
    if (amountEditable && !amount) throw new Error("Enter the amount.");
    const changed =
      date !== entry.date || (amountEditable && amount !== input.amount);
    return changed
      ? { ...input, date, ...(amountEditable ? { amount } : {}) }
      : undefined;
  };

  const run = async (
    kind: "save" | "approve" | "reject" | "discard",
    done: string,
  ) => {
    try {
      const result =
        kind === "reject"
          ? await action.mutateAsync({
              kind,
              id: entry.id,
              version: entry.version,
              reason: reason.trim(),
            })
          : kind === "discard"
            ? await action.mutateAsync({
                kind,
                id: entry.id,
                version: entry.version,
              })
            : await action.mutateAsync({
                kind,
                id: entry.id,
                version: entry.version,
                input: edited(),
              });
      showToast(done);
      const voucher = "voucher" in result ? result.voucher : undefined;
      if (voucher) router.replace(`/voucher/${voucher.id}`);
      else router.back();
    } catch (e) {
      showError("Couldn't do that", e);
    }
  };

  const status = ENTRY_STATUS[entry.status];
  const footer = editable ? (
    <FooterBar>
      <Button
        label="Discard"
        icon="trash-2"
        variant="danger"
        onPress={() => run("discard", "Draft discarded")}
        disabled={action.isPending}
      />
      <View style={{ flex: 1 }}>
        <Button
          label={waits ? "Send for approval" : "Save and post"}
          icon={waits ? "send" : "check"}
          variant="primary"
          block
          loading={action.isPending}
          onPress={() =>
            run("save", waits ? "Sent for approval" : "Saved to the books")
          }
        />
      </View>
    </FooterBar>
  ) : reviewing ? (
    <FooterBar>
      <Button
        label="Send back"
        icon="corner-up-left"
        onPress={() =>
          rejecting && reason.trim()
            ? run("reject", "Sent back")
            : setRejecting(true)
        }
        disabled={action.isPending || (rejecting && !reason.trim())}
      />
      <View style={{ flex: 1 }}>
        <Button
          label="Approve and post"
          icon="check"
          variant="primary"
          block
          loading={action.isPending}
          onPress={() => run("approve", "Approved and posted")}
        />
      </View>
    </FooterBar>
  ) : entry.status === "submitted" ? (
    <FooterBar>
      <Button
        label="Withdraw"
        icon="x"
        block
        loading={action.isPending}
        onPress={() => run("discard", "Withdrawn")}
      />
    </FooterBar>
  ) : undefined;

  return (
    <Screen
      header={
        <Header
          title={`${voucherTypeLabel[entry.voucherType]} to review`}
          subtitle={entry.scheduleName ?? (entry.partyName || undefined)}
        />
      }
      footer={footer}
    >
      <View style={{ gap: space.lg }}>
        <View
          style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}
        >
          <Badge label={status.label} tone={status.tone} />
          <Txt variant="small" tone="body" style={{ flex: 1 }}>
            Not in the books yet.
          </Txt>
        </View>
        {entry.status === "rejected" && entry.rejectReason ? (
          <Card>
            <Txt variant="bodyStrong" tone="give">
              Sent back by {entry.reviewedByName ?? "the approver"}
            </Txt>
            <Txt>{entry.rejectReason}</Txt>
          </Card>
        ) : null}
        <Card>
          {entry.partyName ? (
            <KeyValue label="Party" value={entry.partyName} />
          ) : null}
          <KeyValue label="Amount" value={formatINR(entry.amount)} strong />
          {typeof input.reference === "string" && input.reference ? (
            <KeyValue label="Reference" value={input.reference} />
          ) : null}
          {typeof input.expenseHead === "string" ? (
            <KeyValue label="Spent on" value={input.expenseHead} />
          ) : null}
          {Array.isArray(input.lines) ? (
            <KeyValue label="Lines" value={String(input.lines.length)} />
          ) : null}
          {typeof input.narration === "string" && input.narration ? (
            <KeyValue label="Narration" value={input.narration} />
          ) : null}
          {entry.submittedByName ? (
            <KeyValue
              label="Sent by"
              value={`${entry.submittedByName}${entry.submittedAt ? `, ${formatDate(entry.submittedAt.slice(0, 10))}` : ""}`}
            />
          ) : null}
        </Card>
        {editable || reviewing ? (
          <View style={{ gap: space.md }}>
            <DateField label="Date" value={date} onChange={setDate} />
            {amountEditable ? (
              <AmountField
                label="Amount ₹"
                value={amountText}
                onChangeText={setAmountText}
              />
            ) : null}
            {rejecting ? (
              <TextField
                label="Why are you sending it back?"
                value={reason}
                onChangeText={setReason}
                maxLength={200}
                autoFocus
              />
            ) : null}
            <Txt variant="small" tone="body">
              {reviewing
                ? "Approving posts it with the usual checks and gives it the next number. Sending back returns it to the sender with your reason."
                : waits
                  ? "Your entries of this kind need approval: saving sends it to the owner."
                  : "Saving posts it with the usual checks and gives it the next number."}
            </Txt>
          </View>
        ) : (
          <KeyValue label="Date" value={formatDate(entry.date)} />
        )}
        <SectionHeader title="History" />
        <Card>
          {entry.history.map((h, i) => (
            <KeyValue
              key={i}
              label={`${h.action[0]!.toUpperCase()}${h.action.slice(1)}`}
              value={`${h.userName}, ${formatDate(h.at.slice(0, 10))}${h.note ? ` · ${h.note}` : ""}`}
            />
          ))}
        </Card>
      </View>
    </Screen>
  );
}
