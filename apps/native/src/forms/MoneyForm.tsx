/**
 * One form for Receipts (money in from a customer) and Payments (money out to a supplier).
 * Payments can also deduct TDS: the bill is cleared in full, the bank pays the net amount,
 * and the TDS is owed to the government.
 */
import { router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { Pressable, View } from "react-native";
import {
  allowedDates,
  TDS_SECTIONS,
  tdsBase,
  amountInWords,
  autoAllocate,
  calcTds,
  checkMoney,
  formatDate,
  formatINR,
  parseRupees,
  today,
  voucherPostings,
  type Bill,
  type PaymentMode,
} from "@repo/core";
import {
  AmountField,
  DateField,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  FooterBar,
  Header,
  Icon,
  KeyValue,
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
import { paymentModeLabel } from "@/data/labels";
import { useData } from "@/data/DataProvider";
import { canShowLedgerBalances } from "@/data/accessScope";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";
import {
  useCreatePayment,
  useCreateReceipt,
  useLedgers,
  useNextNumber,
  useParties,
  useParty,
} from "@/data/queries";
import { colors, radius, space } from "@/theme";

export type MoneyKind = "receipt" | "payment";

const TEXT = {
  receipt: {
    title: "Receipt",
    subtitle: "Money received",
    numberLabel: "Receipt no.",
    partyLabel: "Received from",
    partyWord: "customer",
    amountLabel: "Amount received ₹",
    ledgerLabel: "Deposit to",
    saveLabel: "Save receipt",
    leftoverLabel: "On account (advance)",
  },
  payment: {
    title: "Payment",
    subtitle: "Money paid",
    numberLabel: "Payment no.",
    partyLabel: "Paid to",
    partyWord: "supplier",
    amountLabel: "Bill amount to settle ₹",
    ledgerLabel: "Paid from",
    saveLabel: "Save payment",
    leftoverLabel: "On account (advance paid)",
  },
} as const;

const MODES: PaymentMode[] = ["cash", "upi", "bank", "cheque", "card"];

export function MoneyForm({
  kind,
  initialPartyId,
}: {
  kind: MoneyKind;
  initialPartyId?: string;
}) {
  const text = TEXT[kind];
  const { role } = useData();
  const attachments = useFinancialAttachments();
  const [bookScope, setBookScope] = useBookScope();

  // ---- Data -------------------------------------------------------------------
  const parties = useParties(kind === "receipt" ? "customer" : "supplier");
  const ledgers = useLedgers();
  const [date, setDate] = useState(today());
  const nextNumber = useNextNumber(kind, undefined, date);
  const createReceipt = useCreateReceipt();
  const createPayment = useCreatePayment();
  const saving = createReceipt.isPending || createPayment.isPending;

  // ---- Form state ---------------------------------------------------------------
  const [partyId, setPartyId] = useState<string | undefined>(initialPartyId);
  const [amountText, setAmountText] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [bankId, setBankId] = useState("");
  const [reference, setReference] = useState("");
  /** Amount typed against each bill, keyed by bill id (rupees as text). */
  const [allocated, setAllocated] = useState<Record<string, string> | null>(
    null,
  );
  const [withTds, setWithTds] = useState(false);
  const [tdsSection, setTdsSection] = useState(TDS_SECTIONS[0].section);
  const [tdsRateText, setTdsRateText] = useState(String(TDS_SECTIONS[0].rate));
  const [picker, setPicker] = useState<"party" | "bank" | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const party = useParty(partyId ?? "");
  const bills: Bill[] = party.data?.openBills ?? [];
  const ledgerId =
    mode === "cash"
      ? (ledgers.data?.find((row) => row.ledger.kind === "cash")?.ledger.id ??
        "")
      : bankId;
  const ledger = ledgers.data?.find((l) => l.ledger.id === ledgerId)?.ledger;

  // ---- Maths --------------------------------------------------------------------
  /** Bill value being settled (receipts: the money received). */
  const amount = parseRupees(amountText);
  // Default to oldest-first; explicit edits or an advance keep the user's allocation.
  const allocationValues =
    allocated ??
    Object.fromEntries(
      autoAllocate(amount ?? 0, bills).allocations.map((a) => [
        a.voucherId,
        (a.amount / 100).toFixed(2),
      ]),
    );

  const allocations = bills
    .map((bill) => ({
      bill,
      amount: parseRupees(allocationValues[bill.id] ?? "") ?? 0,
    }))
    .filter((a) => a.amount > 0);
  const allocatedTotal = allocations.reduce((s, a) => s + a.amount, 0);
  const tdsRate = Number(tdsRateText) || 0;
  // GST shown on the bills is left out of the TDS base.
  const tds =
    kind === "payment" && withTds && amount
      ? calcTds(tdsBase(amount, allocations), tdsRate)
      : 0;
  /** Money that actually leaves or enters the cash/bank account. */
  const net = (amount ?? 0) - tds;
  const leftover = Math.max((amount ?? 0) - allocatedTotal, 0);
  const problem = checkMoney({ kind, partyId, amount, allocations });

  // Preview of the Dr/Cr lines this voucher will post.
  const postings = voucherPostings(
    {
      id: "draft",
      type: kind,
      number: "",
      date,
      status: "draft",
      amount: net,
      tds: tds
        ? { section: tdsSection, rate: tdsRate, amount: tds }
        : undefined,
      createdAt: "",
    },
    {
      party:
        party.data?.party.name ??
        (kind === "receipt" ? "Customer" : "Supplier"),
      ledger: ledger?.name ?? "Bank",
    },
  );

  // ---- Actions ------------------------------------------------------------------
  const pickParty = (id: string) => {
    setPartyId(id);
    setAllocated(null);
    setPicker(null);
  };

  const pickSection = (section: string) => {
    setTdsSection(section);
    setTdsRateText(
      String(TDS_SECTIONS.find((s) => s.section === section)?.rate ?? 0),
    );
  };

  /** Fill bill amounts oldest first, up to the amount. */
  const autoFill = () => {
    setAllocated(null);
  };

  const toggleBill = (bill: Bill) => {
    setAllocated((prev) => {
      prev ??= allocationValues;
      if (prev[bill.id]) {
        const { [bill.id]: _removed, ...rest } = prev;
        return rest;
      }
      const left = Math.max((amount ?? 0) - allocatedTotal, 0);
      const take = Math.min(left || bill.pending, bill.pending);
      return { ...prev, [bill.id]: (take / 100).toFixed(2) };
    });
  };

  const save = async () => {
    setShowErrors(true);
    if (problem || !partyId || !amount) return;
    if (!ledger || !party.data || party.isError || ledgers.isError) {
      showError(
        "Couldn't save",
        new Error(
          "Load the customer's bills and choose a valid account before saving.",
        ),
      );
      return;
    }
    const input = {
      bookScope,
      partyId,
      date,
      amount: net,
      mode,
      ledgerId,
      reference: reference || undefined,
      allocations: allocations.map((a) => ({
        voucherId: a.bill.id,
        amount: a.amount,
      })),
      tds: tds
        ? { section: tdsSection, rate: tdsRate, amount: tds }
        : undefined,
    };
    try {
      const saved = await attachments.save(
        kind === "receipt" ? "/receipts" : "/payments",
        input,
        kind === "receipt"
          ? createReceipt.mutateAsync
          : createPayment.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  const footerNote = () => {
    if (showErrors && problem) return problem;
    if (!amount)
      return kind === "receipt"
        ? "Enter the amount received"
        : "Enter the amount to pay";
    if (tds) return `TDS ${formatINR(tds)} kept back`;
    return leftover > 0
      ? `${formatINR(leftover)} on account`
      : "Fully allocated";
  };

  return (
    <Screen
      header={<Header close title={text.title} subtitle={text.subtitle} />}
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Money value={net} variant="heading" />
            <Txt
              variant="caption"
              tone={showErrors && problem ? "give" : "body"}
              numberOfLines={2}
            >
              {footerNote()}
            </Txt>
          </View>
          <Button
            label={text.saveLabel}
            variant="primary"
            onPress={save}
            loading={saving || attachments.busy}
            disabled={showErrors && !!problem}
          />
        </FooterBar>
      }
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label={text.numberLabel}
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
        <SelectField
          label={text.partyLabel}
          value={
            party.data?.party.name ??
            parties.data?.find((r) => r.party.id === partyId)?.party.name
          }
          placeholder={`Pick a ${text.partyWord}`}
          onPress={() => setPicker("party")}
          error={
            showErrors && !partyId ? `Pick a ${text.partyWord}.` : undefined
          }
        />
        {party.data ? (
          <Txt variant="small" tone="body" num>
            Outstanding {formatINR(Math.abs(party.data.balance))} ·{" "}
            {party.data.openBills.length} open bills
          </Txt>
        ) : null}
      </View>

      <Card variant="soft" style={{ alignItems: "center", gap: space.sm }}>
        <View style={{ flexDirection: "row", alignSelf: "stretch" }}>
          <AmountField
            label={text.amountLabel}
            value={amountText}
            onChangeText={setAmountText}
            error={showErrors && !amount ? "Enter the amount." : undefined}
          />
        </View>
        <Txt variant="caption" tone="body" center>
          {amountInWords(amount ?? 0)}
        </Txt>
      </Card>

      {kind === "payment" ? (
        <View style={{ gap: space.md }}>
          <Txt variant="heading">TDS</Txt>
          <Segmented
            value={withTds ? "yes" : "no"}
            onChange={(v) => setWithTds(v === "yes")}
            options={[
              { value: "no", label: "No TDS" },
              { value: "yes", label: "Deduct TDS" },
            ]}
          />
          {withTds ? (
            <>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {TDS_SECTIONS.map((s) => (
                  <Chip
                    key={s.section}
                    label={`${s.section} · ${s.label}`}
                    selected={tdsSection === s.section}
                    onPress={() => pickSection(s.section)}
                  />
                ))}
              </View>
              <View
                style={{
                  flexDirection: "row",
                  gap: space.md,
                  alignItems: "flex-end",
                }}
              >
                <TextField
                  label="Rate %"
                  value={tdsRateText}
                  keyboardType="decimal-pad"
                  onChangeText={(t) =>
                    setTdsRateText(t.replace(/[^0-9.]/g, ""))
                  }
                />
                <View style={{ flex: 1, paddingBottom: 12 }}>
                  <Txt variant="small" tone="body">
                    TDS kept back
                  </Txt>
                  <Money value={tds} variant="bodyStrong" />
                  {amount && tdsBase(amount, allocations) !== amount ? (
                    <Txt variant="caption" tone="body">
                      On {formatINR(tdsBase(amount, allocations))}, without the
                      GST on the bills
                    </Txt>
                  ) : null}
                </View>
              </View>
              <Card style={{ gap: 0 }}>
                <KeyValue
                  label="Bill amount settled"
                  value={formatINR(amount ?? 0)}
                />
                <KeyValue
                  label={`Less TDS ${tdsSection} @ ${tdsRate}%`}
                  value={`−${formatINR(tds)}`}
                />
                <KeyValue
                  label="Net paid from bank/cash"
                  value={formatINR(net)}
                  strong
                />
              </Card>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt variant="label" tone="charcoal">
          Mode
        </Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {MODES.map((m) => (
            <Chip
              key={m}
              label={paymentModeLabel[m]}
              selected={mode === m}
              onPress={() => setMode(m)}
            />
          ))}
        </View>
        {mode !== "cash" ? (
          <View style={{ flexDirection: "row", gap: space.md }}>
            <SelectField
              label={text.ledgerLabel}
              value={ledger?.shortName}
              onPress={() => setPicker("bank")}
            />
            <TextField
              label={mode === "cheque" ? "Cheque no." : "UTR / reference"}
              value={reference}
              onChangeText={setReference}
              mono
            />
          </View>
        ) : null}
      </View>

      {/* Bill-wise allocation */}
      <View style={{ gap: space.md }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Txt variant="heading">Settle bills</Txt>
          <Button
            label="Auto-allocate oldest first"
            size="sm"
            onPress={autoFill}
            disabled={!amount || bills.length === 0}
          />
        </View>
        <Button
          label="Keep as advance"
          icon="pause"
          size="sm"
          onPress={() => setAllocated({})}
          disabled={!amount}
        />
        {!partyId ? (
          <Txt variant="small" tone="body">
            Pick a {text.partyWord} to see their open bills.
          </Txt>
        ) : party.isError ? (
          <View>
            <Txt>{party.error.message}</Txt>
            <Button
              label="Retry"
              onPress={() => {
                void party.refetch();
              }}
            />
          </View>
        ) : party.isPending ? (
          <Txt>Loading bills...</Txt>
        ) : bills.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title="No open bills"
            message="The amount will be saved as an advance on account."
          />
        ) : (
          bills.map((bill) => (
            <BillRow
              key={bill.id}
              bill={bill}
              value={allocationValues[bill.id]}
              onToggle={() => toggleBill(bill)}
              onChange={(t) =>
                setAllocated({ ...allocationValues, [bill.id]: t })
              }
            />
          ))
        )}
        {partyId ? (
          <Card style={{ gap: 0 }}>
            <KeyValue
              label={kind === "receipt" ? "Received" : "Bill amount settled"}
              value={formatINR(amount ?? 0)}
            />
            <KeyValue
              label="Settled against bills"
              value={formatINR(allocatedTotal)}
            />
            <KeyValue
              label={text.leftoverLabel}
              value={formatINR(leftover)}
              strong
            />
          </Card>
        ) : null}
      </View>

      <AttachmentPicker {...attachments} />
      <BookScopeField value={bookScope} onChange={setBookScope} />
      {amount ? <PostingTable rows={postings} /> : null}

      <PickerSheet
        visible={picker === "party"}
        title={`Pick ${text.partyWord}`}
        searchPlaceholder={`Search ${text.partyWord}s`}
        onClose={() => setPicker(null)}
        onSelect={pickParty}
        options={(parties.data ?? []).map((r) => ({
          id: r.party.id,
          title: r.party.name,
          subtitle: `${r.party.city} · ${r.party.phone}`,
          right: (
            <Money
              value={Math.abs(r.balance)}
              variant="small"
              tone={r.balance > 0 ? "get" : r.balance < 0 ? "give" : "body"}
            />
          ),
        }))}
      />
      <PickerSheet
        visible={picker === "bank"}
        title={text.ledgerLabel}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setBankId(id);
          setPicker(null);
        }}
        options={(ledgers.data ?? [])
          .filter((l) => l.ledger.kind === "bank")
          .map((l) => ({
            id: l.ledger.id,
            title: l.ledger.name,
            right: canShowLedgerBalances(role) ? (
              <Money value={l.balance} variant="small" />
            ) : undefined,
          }))}
      />
    </Screen>
  );
}

/** One open bill with a tick box; when ticked, shows how much of it to settle. */
function BillRow({
  bill,
  value,
  onToggle,
  onChange,
}: {
  bill: Bill;
  value?: string;
  onToggle: () => void;
  onChange: (text: string) => void;
}) {
  const selected = !!value;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: selected ? colors.ink : colors.hairline,
        borderRadius: radius.card,
        padding: 12,
        gap: space.sm,
      }}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: space.md }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: selected ? colors.ink : colors.mute,
            backgroundColor: selected ? colors.ink : colors.canvas,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selected ? (
            <Icon name="check" size={14} color={colors.onPrimary} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="mono">{bill.number}</Txt>
          <Txt variant="caption" tone="body" num>
            {formatDate(bill.date)} · pending {formatINR(bill.pending)}
          </Txt>
        </View>
        {bill.overdueDays > 0 ? (
          <Badge label={`Overdue ${bill.overdueDays} d`} tone="warn" />
        ) : (
          <Badge label="Not due" />
        )}
      </Pressable>
      {selected ? (
        <View style={{ flexDirection: "row" }}>
          <AmountField
            label="Settle ₹"
            value={value ?? ""}
            onChangeText={onChange}
          />
        </View>
      ) : null}
    </View>
  );
}
