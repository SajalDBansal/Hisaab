import { router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { View } from "react-native";
import {
  allowedDates,
  amountInWords,
  checkExpense,
  parseRupees,
  today,
  voucherPostings,
  type PaymentMode,
} from "@repo/core";
import {
  AmountField,
  DateField,
  Button,
  Card,
  Chip,
  FooterBar,
  Header,
  Money,
  PickerSheet,
  PostingTable,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCreateExpense, useLedgers, useNextNumber } from "@/data/queries";
import { space } from "@/theme";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";

/** Common expense heads. "Other" lets the user type their own. */
const HEADS = [
  "Rent",
  "Electricity",
  "Salary",
  "Freight Inward",
  "Freight Outward",
  "Telephone & Internet",
  "Repairs",
  "Office Expenses",
  "Other",
];

/** Record money spent on a business expense. */
export default function NewExpenseScreen() {
  const attachments = useFinancialAttachments();
  const ledgers = useLedgers();
  const [date, setDate] = useState(today());
  const [bookScope, setBookScope] = useBookScope();
  const nextNumber = useNextNumber("expense", undefined, date);
  const createExpense = useCreateExpense();

  const [head, setHead] = useState("");
  const [otherHead, setOtherHead] = useState("");
  const [amountText, setAmountText] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [bankId, setBankId] = useState("");
  const [note, setNote] = useState("");
  const [pickBank, setPickBank] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const expenseHead = head === "Other" ? otherHead.trim() : head;
  const amount = parseRupees(amountText);
  const ledgerId =
    mode === "cash"
      ? (ledgers.data?.find((row) => row.ledger.kind === "cash")?.ledger.id ??
        "")
      : bankId;
  const ledger = ledgers.data?.find((l) => l.ledger.id === ledgerId)?.ledger;
  const problem = checkExpense({ expenseHead, amount });

  const postings = voucherPostings(
    {
      id: "draft",
      type: "expense",
      number: "",
      date,
      status: "draft",
      expenseHead: expenseHead || "Expenses",
      amount: amount ?? 0,
      createdAt: "",
    },
    { ledger: ledger?.name ?? "Cash" },
  );

  const save = async () => {
    setShowErrors(true);
    if (problem || !amount) return;
    try {
      const saved = await attachments.save(
        "/expenses",
        {
          bookScope,
          date,
          expenseHead,
          amount,
          mode,
          ledgerId,
          narration: note || undefined,
        },
        createExpense.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={<Header close title="Expense" subtitle="Money spent" />}
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Money value={amount ?? 0} variant="heading" />
            <Txt
              variant="caption"
              tone={showErrors && problem ? "give" : "body"}
              numberOfLines={2}
            >
              {showErrors && problem
                ? problem
                : expenseHead || "Pick what it was for"}
            </Txt>
          </View>
          <Button
            label="Save expense"
            variant="primary"
            onPress={save}
            loading={createExpense.isPending || attachments.busy}
            disabled={showErrors && !!problem}
          />
        </FooterBar>
      }
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label="Expense no."
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

      <View style={{ gap: space.sm }}>
        <Txt variant="label" tone="charcoal">
          Spent on
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {HEADS.map((h) => (
            <Chip
              key={h}
              label={h}
              selected={head === h}
              onPress={() => setHead(h)}
            />
          ))}
        </View>
        {head === "Other" ? (
          <View style={{ flexDirection: "row" }}>
            <TextField
              label="Expense name"
              value={otherHead}
              onChangeText={setOtherHead}
              placeholder="e.g. Shop cleaning"
            />
          </View>
        ) : null}
        {showErrors && !expenseHead ? (
          <Txt variant="caption" tone="give">
            Pick what the money was spent on.
          </Txt>
        ) : null}
      </View>

      <Card variant="soft" style={{ alignItems: "center", gap: space.sm }}>
        <View style={{ flexDirection: "row", alignSelf: "stretch" }}>
          <AmountField
            label="Amount ₹"
            value={amountText}
            onChangeText={setAmountText}
          />
        </View>
        <Txt variant="caption" tone="body" center>
          {amountInWords(amount ?? 0)}
        </Txt>
      </Card>

      <View style={{ gap: space.md }}>
        <Txt variant="label" tone="charcoal">
          Paid by
        </Txt>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "cash", label: "Cash" },
            { value: "upi", label: "UPI" },
            { value: "bank", label: "Bank" },
          ]}
        />
        {mode !== "cash" ? (
          <View style={{ flexDirection: "row" }}>
            <SelectField
              label="Paid from"
              value={ledger?.name}
              onPress={() => setPickBank(true)}
            />
          </View>
        ) : null}
        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Transport to Agra"
          multiline
        />
      </View>

      <AttachmentPicker {...attachments} />
      <BookScopeField value={bookScope} onChange={setBookScope} />
      {amount ? <PostingTable rows={postings} /> : null}

      <PickerSheet
        visible={pickBank}
        title="Paid from"
        onClose={() => setPickBank(false)}
        onSelect={(id) => {
          setBankId(id);
          setPickBank(false);
        }}
        options={(ledgers.data ?? [])
          .filter((l) => l.ledger.kind === "bank")
          .map((l) => ({
            id: l.ledger.id,
            title: l.ledger.name,
            right: <Money value={l.balance} variant="small" />,
          }))}
      />
    </Screen>
  );
}
