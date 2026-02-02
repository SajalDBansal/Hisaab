import { router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { View } from "react-native";
import {
  allowedDates,
  checkJournal,
  formatINR,
  parseRupees,
  today,
  type Posting,
} from "@repo/core";
import {
  AmountField,
  DateField,
  Button,
  Card,
  FooterBar,
  Header,
  IconButton,
  PickerSheet,
  PostingTable,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
  ErrorState,
} from "@/components";
import {
  useCreateJournal,
  useNextNumber,
  usePickableAccounts,
} from "@/data/queries";
import { space } from "@/theme";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";

interface Line {
  account: string;
  name: string;
  side: "dr" | "cr";
  amountText: string;
}

const blank = (side: Line["side"]): Line => ({
  account: "",
  name: "",
  side,
  amountText: "",
});

/**
 * Journal entry: adjustments that are not a sale, purchase or payment —
 * depreciation, salary due, provisions, corrections. Debits must equal credits.
 */
export default function NewJournalScreen() {
  const attachments = useFinancialAttachments();
  const accounts = usePickableAccounts();
  const [date, setDate] = useState(today());
  const [bookScope, setBookScope] = useBookScope();
  const nextNumber = useNextNumber("journal", undefined, date);
  const createJournal = useCreateJournal();

  const [lines, setLines] = useState<Line[]>([blank("dr"), blank("cr")]);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const update = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const amounts = lines.map((l) => ({
    account: l.account,
    name: l.name,
    debit: l.side === "dr" ? (parseRupees(l.amountText) ?? 0) : 0,
    credit: l.side === "cr" ? (parseRupees(l.amountText) ?? 0) : 0,
  }));
  const debit = amounts.reduce((s, l) => s + l.debit, 0);
  const credit = amounts.reduce((s, l) => s + l.credit, 0);
  const problem = checkJournal(amounts);
  const postings: Posting[] = amounts
    .filter((l) => l.account && (l.debit || l.credit))
    .map((l) => ({
      account: l.account,
      ledger: l.name,
      debit: l.debit,
      credit: l.credit,
    }));

  /** Fill a new line with the amount that would balance the entry. */
  const addLine = () => {
    const diff = debit - credit;
    const line = blank(diff > 0 ? "cr" : "dr");
    if (diff !== 0) line.amountText = String(Math.abs(diff) / 100);
    setLines([...lines, line]);
  };

  const save = async () => {
    setShowErrors(true);
    if (problem) return;
    try {
      const saved = await attachments.save(
        "/journals",
        {
          bookScope,
          date,
          lines: amounts.filter((l) => l.account),
          narration: note.trim() || undefined,
        },
        createJournal.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={<Header close title="Journal" subtitle="Adjustment entry" />}
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Txt variant="small" num>
              Dr {formatINR(debit)} · Cr {formatINR(credit)}
            </Txt>
            <Txt
              variant="caption"
              tone={debit === credit && debit > 0 ? "get" : "body"}
              numberOfLines={2}
            >
              {showErrors && problem
                ? problem
                : debit === credit && debit > 0
                  ? "Balanced"
                  : `Difference ${formatINR(Math.abs(debit - credit))}`}
            </Txt>
          </View>
          <Button
            label="Save journal"
            variant="primary"
            onPress={save}
            loading={createJournal.isPending || attachments.busy}
            disabled={
              accounts.isPending ||
              accounts.isError ||
              (!!problem && showErrors)
            }
          />
        </FooterBar>
      }
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label="Journal no."
          value={nextNumber.data ?? "…"}
          editable={false}
          mono
        />
        <DateField
          value={date}
          onChange={setDate}
          min={allowedDates().min}
          max={allowedDates().max}
        />
      </View>

      <View style={{ gap: space.md }}>
        {accounts.isError ? (
          <ErrorState onRetry={() => accounts.refetch()} />
        ) : null}
        <Button
          label="New ledger"
          icon="plus"
          onPress={() => router.push("/account/new")}
        />
        <Txt variant="heading">Lines</Txt>
        {lines.map((l, i) => (
          <Card key={i} style={{ gap: space.md }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Txt variant="label" tone="body" style={{ flex: 1 }}>
                Line {i + 1}
              </Txt>
              {lines.length > 2 ? (
                <IconButton
                  icon="trash-2"
                  label={`Remove line ${i + 1}`}
                  onPress={() => setLines(lines.filter((_, j) => j !== i))}
                />
              ) : null}
            </View>
            <View style={{ flexDirection: "row" }}>
              <SelectField
                label="Account"
                value={l.name || undefined}
                placeholder="Pick an account"
                onPress={() => setPicking(i)}
              />
            </View>
            <Segmented
              value={l.side}
              onChange={(side) => update(i, { side })}
              options={[
                { value: "dr", label: "Debit (Dr)" },
                { value: "cr", label: "Credit (Cr)" },
              ]}
            />
            <View style={{ flexDirection: "row" }}>
              <AmountField
                label="Amount ₹"
                value={l.amountText}
                onChangeText={(amountText) => update(i, { amountText })}
              />
            </View>
          </Card>
        ))}
        <Button label="Add line" icon="plus" onPress={addLine} />
      </View>

      <TextField
        label="Narration"
        value={note}
        onChangeText={setNote}
        placeholder="e.g. Depreciation on furniture for the half year"
        multiline
      />

      <AttachmentPicker {...attachments} />
      <BookScopeField value={bookScope} onChange={setBookScope} />
      {postings.length > 0 ? <PostingTable rows={postings} /> : null}

      <PickerSheet
        visible={picking !== null}
        title="Account"
        searchPlaceholder="Search accounts"
        onClose={() => setPicking(null)}
        onSelect={(key) => {
          const a = accounts.data?.find((x) => x.key === key);
          if (picking !== null && a)
            update(picking, { account: a.key, name: a.name });
          setPicking(null);
        }}
        options={(accounts.data ?? []).map((a) => ({
          id: a.key,
          title: a.name,
          subtitle: a.group,
        }))}
      />
    </Screen>
  );
}
