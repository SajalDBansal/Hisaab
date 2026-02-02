import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  allowedDates,
  calcInvoice,
  formatDate,
  formatINR,
  today,
  type ReturnableBill,
} from "@repo/core";
import {
  Button,
  Card,
  Chip,
  DateField,
  EmptyState,
  FooterBar,
  Header,
  KeyValue,
  Money,
  PickerSheet,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCreateNote, useInvoices, useReturnable } from "@/data/queries";
import { colors, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";

const REASONS = [
  "Damaged",
  "Expired",
  "Wrong item",
  "Quality issue",
  "Excess supply",
  "Other",
];

/**
 * Sales return (credit note) or purchase return (debit note) against one bill.
 * /note/new?kind=credit&against=<billId> — without `against`, pick the bill first.
 */
export default function NewNoteScreen() {
  const params = useLocalSearchParams<{
    kind?: "credit" | "debit";
    against?: string;
  }>();
  const kind = params.kind === "debit" ? "debit" : "credit";
  const isCredit = kind === "credit";
  const [billId, setBillId] = useState(params.against ?? "");
  const [picking, setPicking] = useState(false);
  const bills = useInvoices(isCredit ? "sale" : "purchase");
  const returnable = useReturnable(billId);
  const title = isCredit ? "Sales return" : "Purchase return";

  const pickable = (bills.data ?? []).filter(
    (r) => r.voucher.status === "posted",
  );

  return (
    <>
      {billId && returnable.data ? (
        <NoteForm
          kind={kind}
          title={title}
          data={returnable.data}
          onChangeBill={() => setPicking(true)}
        />
      ) : (
        <Screen
          header={
            <Header
              close
              title={title}
              subtitle={isCredit ? "Credit note" : "Debit note"}
            />
          }
        >
          {billId ? (
            <QueryView query={returnable}>{() => null}</QueryView>
          ) : (
            <>
              <Txt variant="small" tone="body">
                {isCredit
                  ? "Pick the sale invoice the goods came back from."
                  : "Pick the purchase bill the goods are going back against."}
              </Txt>
              <View style={{ flexDirection: "row" }}>
                <SelectField
                  label={isCredit ? "Sale invoice" : "Purchase bill"}
                  placeholder="Pick a bill"
                  onPress={() => setPicking(true)}
                />
              </View>
            </>
          )}
        </Screen>
      )}
      <PickerSheet
        visible={picking}
        title={isCredit ? "Pick a sale invoice" : "Pick a purchase bill"}
        searchPlaceholder="Party or bill number"
        onClose={() => setPicking(false)}
        onSelect={(id) => {
          setBillId(id);
          setPicking(false);
        }}
        options={pickable.map((r) => ({
          id: r.voucher.id,
          title: r.partyName,
          subtitle: `${r.voucher.number} · ${formatDate(r.voucher.date)}`,
          right: <Money value={r.voucher.amount} variant="small" />,
        }))}
      />
    </>
  );
}

function NoteForm({
  kind,
  title,
  data,
  onChangeBill,
}: {
  kind: "credit" | "debit";
  title: string;
  data: ReturnableBill;
  onChangeBill: () => void;
}) {
  const isCredit = kind === "credit";
  const create = useCreateNote(kind);
  const attachments = useFinancialAttachments();
  const gst = useGstMode();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const bill = data.bill;
  const [date, setDate] = useState(today());
  // A return can't be dated before its bill
  const minDate =
    bill.date > allowedDates().min ? bill.date : allowedDates().min;

  const chosen = data.lines
    .map((l) => ({ ...l, take: Number(qty[l.index] || "0") }))
    .filter((l) => l.take > 0);
  // Same maths as the server: the bill's own lines with the returned quantity
  const noteLines = chosen.map((l) => ({
    ...bill.lines![l.index],
    qty: l.take,
  }));
  const totals = calcInvoice({
    lines: noteLines,
    interState: !!bill.interState,
  });
  const reasonText = reason === "Other" ? otherReason.trim() : reason;
  const over = chosen.find((l) => l.take > l.returnable);
  const problem = over
    ? `Only ${over.returnable} ${over.unit} of ${over.itemName} left to return.`
    : !chosen.length
      ? "Enter how many came back for at least one item."
      : !reasonText
        ? "Pick a reason."
        : null;

  const save = async () => {
    setShowErrors(true);
    if (problem) return;
    try {
      const note = await attachments.save(
        isCredit ? "/credit-notes" : "/debit-notes",
        {
          againstId: bill.id,
          date,
          lines: chosen.map((l) => ({ index: l.index, qty: l.take })),
          reason: reasonText,
        },
        create.mutateAsync,
      );
      router.replace(`/voucher/${note.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title={title}
          subtitle={isCredit ? "Credit note" : "Debit note"}
        />
      }
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Money value={totals.grandTotal} variant="heading" />
            <Txt
              variant="caption"
              tone={showErrors && problem ? "give" : "body"}
              numberOfLines={2}
            >
              {showErrors && problem
                ? problem
                : isCredit
                  ? `${data.partyName} will owe this much less`
                  : `You will owe ${data.partyName} this much less`}
            </Txt>
          </View>
          <Button
            label={isCredit ? "Save credit note" : "Save debit note"}
            variant="primary"
            onPress={save}
            loading={create.isPending || attachments.busy}
          />
        </FooterBar>
      }
    >
      <Card style={{ gap: 0 }} onPress={onChangeBill}>
        <KeyValue
          label={isCredit ? "Against invoice" : "Against bill"}
          value={bill.number}
          strong
        />
        <KeyValue label="Party" value={data.partyName} />
        <KeyValue
          label="Bill date · total"
          value={`${formatDate(bill.date)} · ${formatINR(bill.amount)}`}
        />
        <Txt variant="caption" tone="body" style={{ paddingTop: space.sm }}>
          Tap to pick a different bill
        </Txt>
      </Card>

      <View style={{ flexDirection: "row" }}>
        <DateField
          label="Return date"
          value={date}
          onChange={setDate}
          min={minDate}
          max={allowedDates().max}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="heading">What came back</Txt>
        {data.lines.map((l) => (
          <Card key={l.index} style={{ gap: space.sm }}>
            <Txt variant="bodyStrong">{l.itemName}</Txt>
            <Txt variant="caption" tone="body" num>
              Billed {l.qty} {l.unit} × {formatINR(l.rate)}
              {l.returned ? ` · already returned ${l.returned}` : ""}
            </Txt>
            {l.returnable > 0 ? (
              <View
                style={{
                  flexDirection: "row",
                  gap: space.sm,
                  alignItems: "flex-end",
                }}
              >
                <TextField
                  label={`Qty returned (${l.unit})`}
                  value={qty[l.index] ?? ""}
                  onChangeText={(t) =>
                    setQty({ ...qty, [l.index]: t.replace(/\D/g, "") })
                  }
                  keyboardType="number-pad"
                  placeholder="0"
                  error={
                    Number(qty[l.index] || "0") > l.returnable
                      ? `Max ${l.returnable}`
                      : undefined
                  }
                />
                <View style={{ paddingBottom: 6 }}>
                  <Chip
                    label={`All ${l.returnable}`}
                    onPress={() =>
                      setQty({ ...qty, [l.index]: String(l.returnable) })
                    }
                  />
                </View>
              </View>
            ) : (
              <Txt variant="caption" tone="body">
                Fully returned
              </Txt>
            )}
          </Card>
        ))}
        {data.lines.every((l) => l.returnable === 0) ? (
          <EmptyState
            icon="check-circle"
            title="Everything on this bill is already returned"
          />
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="label" tone="charcoal">
          Reason
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {REASONS.map((r) => (
            <Chip
              key={r}
              label={r}
              selected={reason === r}
              onPress={() => setReason(r)}
            />
          ))}
        </View>
        {reason === "Other" ? (
          <View style={{ flexDirection: "row" }}>
            <TextField
              label="Write the reason"
              value={otherReason}
              onChangeText={setOtherReason}
            />
          </View>
        ) : null}
      </View>

      {chosen.length ? (
        <Card style={{ gap: 0 }}>
          <KeyValue
            label={totals.tax ? "Taxable value" : "Value"}
            value={formatINR(totals.taxable)}
          />
          {totals.tax ? (
            <KeyValue label="GST reversed" value={formatINR(totals.tax)} />
          ) : null}
          {totals.roundOff ? (
            <KeyValue label="Round off" value={formatINR(totals.roundOff)} />
          ) : null}
          <KeyValue
            label={isCredit ? "Credit note total" : "Debit note total"}
            value={formatINR(totals.grandTotal)}
            strong
          />
        </Card>
      ) : null}
      <Txt variant="caption" tone="body" style={{ color: colors.body }}>
        {!gst.regular
          ? isCredit
            ? "Stock comes back in and the customer's balance goes down."
            : "Stock goes out and what you owe the supplier goes down."
          : isCredit
            ? "Stock comes back in, and the GST on these goods is taken off this month's output tax."
            : "Stock goes out, and the GST credit on these goods is taken off this month's input credit."}
      </Txt>
      <AttachmentPicker {...attachments} />
    </Screen>
  );
}
