import { router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { View } from "react-native";
import {
  allowedDates,
  amountInWords,
  calcInvoice,
  checkExpense,
  claimsInputTax,
  formatINR,
  parseRupees,
  today,
  UNREGISTERED_SUPPLIER_GST_MESSAGE,
  voucherPostings,
  type GstRate,
  type PaymentMode,
} from "@repo/core";
import {
  AmountField,
  DateField,
  Button,
  Card,
  Checkbox,
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
import {
  useCreateExpense,
  useFirm,
  useLedgers,
  useNextNumber,
  useParties,
} from "@/data/queries";
import { useGstMode } from "@/data/gstMode";
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
  // GST on the supplier's bill: only a regular firm claims it as input credit.
  const gstMode = useGstMode();
  const canClaimGst = claimsInputTax(gstMode.mode);
  const firm = useFirm();
  const suppliers = useParties("supplier");
  const [withGst, setWithGst] = useState(false);
  const [supplierId, setSupplierId] = useState<string | undefined>();
  const [gstRate, setGstRate] = useState<GstRate>(18);
  const [pickSupplier, setPickSupplier] = useState(false);

  const expenseHead = head === "Other" ? otherHead.trim() : head;
  const entered = parseRupees(amountText);
  const gst = canClaimGst && withGst;
  const supplier = suppliers.data?.find(
    (r) => r.party.id === supplierId,
  )?.party;
  const interState =
    !!supplier && !!firm.data && supplier.stateCode !== firm.data.stateCode;
  const charges =
    gst && entered
      ? [{ name: expenseHead || "Expenses", amount: entered, gstRate }]
      : undefined;
  const taxTotals = charges
    ? calcInvoice({ lines: [], charges, interState })
    : undefined;
  /** Money that leaves cash/bank: the bill total including GST. */
  const amount = taxTotals ? taxTotals.totalBeforeRound : entered;
  const gstProblem = !gst
    ? undefined
    : !supplier
      ? "Pick the supplier whose bill shows the GST."
      : !supplier.gstin?.trim()
        ? UNREGISTERED_SUPPLIER_GST_MESSAGE
        : undefined;
  const ledgerId =
    mode === "cash"
      ? (ledgers.data?.find((row) => row.ledger.kind === "cash")?.ledger.id ??
        "")
      : bankId;
  const ledger = ledgers.data?.find((l) => l.ledger.id === ledgerId)?.ledger;
  const problem = checkExpense({ expenseHead, amount }) ?? gstProblem;

  const postings = voucherPostings(
    {
      id: "draft",
      type: "expense",
      number: "",
      date,
      status: "draft",
      expenseHead: expenseHead || "Expenses",
      amount: amount ?? 0,
      charges,
      interState,
      taxMode: gstMode.mode,
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
          gst:
            gst && supplierId && entered
              ? { partyId: supplierId, rate: gstRate, taxable: entered }
              : undefined,
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
            label={gst ? "Amount before GST ₹" : "Amount ₹"}
            value={amountText}
            onChangeText={setAmountText}
          />
        </View>
        {taxTotals ? (
          <Txt variant="caption" tone="body" center>
            GST {gstRate}% {formatINR(taxTotals.tax)} · Total{" "}
            {formatINR(taxTotals.totalBeforeRound)}
          </Txt>
        ) : null}
        <Txt variant="caption" tone="body" center>
          {amountInWords(amount ?? 0)}
        </Txt>
      </Card>

      {canClaimGst ? (
        <View style={{ gap: space.sm }}>
          <Checkbox
            label="GST on this bill"
            note="Claim the GST shown on a registered supplier's bill as input credit. If it can't be claimed, leave this off and enter the full amount."
            checked={withGst}
            onChange={setWithGst}
          />
          {withGst ? (
            <>
              <View style={{ flexDirection: "row" }}>
                <SelectField
                  label="Supplier"
                  value={
                    supplier
                      ? `${supplier.name}${supplier.gstin ? ` · ${supplier.gstin}` : ""}`
                      : undefined
                  }
                  placeholder="Pick the supplier"
                  onPress={() => setPickSupplier(true)}
                />
              </View>
              <Segmented
                value={String(gstRate)}
                onChange={(rate) => setGstRate(Number(rate) as GstRate)}
                options={[
                  { value: "5", label: "GST 5%" },
                  { value: "18", label: "GST 18%" },
                  { value: "40", label: "GST 40%" },
                ]}
              />
              {showErrors && gstProblem ? (
                <Txt variant="caption" tone="give">
                  {gstProblem}
                </Txt>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

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
      {gst ? null : (
        <BookScopeField value={bookScope} onChange={setBookScope} />
      )}
      {amount ? <PostingTable rows={postings} /> : null}

      <PickerSheet
        visible={pickSupplier}
        title="Supplier"
        searchPlaceholder="Search suppliers"
        onClose={() => setPickSupplier(false)}
        onSelect={(id) => {
          setSupplierId(id);
          setPickSupplier(false);
        }}
        options={(suppliers.data ?? []).map((r) => ({
          id: r.party.id,
          title: r.party.name,
          subtitle: r.party.gstin || "No GSTIN",
        }))}
      />
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
