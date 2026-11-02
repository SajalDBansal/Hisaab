/**
 * One form for both Sale and Purchase invoices.
 * The only differences (labels, party type, default price, which save call) live in `TEXT` and `kind` checks.
 */
import { router, useFocusEffect } from "expo-router";
import { useData } from "@/data/DataProvider";
import { canShowLedgerBalances } from "@/data/accessScope";
import { useCallback, useEffect, useState } from "react";
import { Modal, View } from "react-native";
import { quantityInput } from "@/data/quantityInput";
import {
  amountInWords,
  bookScopeOf,
  calcInvoice,
  calcLine,
  docTypeLabel,
  itemTaxType,
  taxTypeLabel,
  NON_GST_MIX_MESSAGE,
  type Voucher,
  type OrderType,
  allowedDates,
  isOrderType,
  formatQty,
  lineQtyText,
  checkInvoice,
  formatDate,
  formatINR,
  parseRupees,
  today,
  voucherPostings,
  type ExtraCharge,
  type InvoiceLine,
  type Item,
  type PaymentMode,
  applyGstMode,
  billsCarryGst,
  modeBlocker,
  saleDocFor,
  voucherMode,
  count,
} from "@repo/core";
import {
  AmountField,
  Badge,
  Button,
  Card,
  Checkbox,
  DateField,
  FooterBar,
  Header,
  IconButton,
  KeyValue,
  Money,
  Notice,
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
  useCreatePurchase,
  useCreateSales,
  useStockLots,
  useCreateOrder,
  useUpdateInvoice,
  useFirm,
  useItems,
  useLedgers,
  useNextNumber,
  useParties,
  useParty,
} from "@/data/queries";
import { takePicked } from "@/data/picked";
import { colors, space } from "@/theme";
import { useGstMode } from "@/data/gstMode";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { InvoiceAssociates } from "@/components/associates/InvoiceAssociates";
import type { InvoiceAssociatesInput } from "@repo/contracts/src/associates";
import { useApproveSaleCredit } from "@/data/settlementHooks";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";
import {
  invoiceDrafts,
  invoiceDraftItem,
  invoiceDraftUnit,
  invoiceDraftLine,
  invoiceDraftCharges,
  type LineDraft,
} from "./invoiceDraft";

/** Bills, plus estimates and orders (same form, no payment and no posting). */
export type InvoiceKind = "sale" | "purchase" | OrderType;

const TEXT = {
  sale: {
    title: "New Sale",
    numberLabel: "Invoice no.",
    partyLabel: "Bill to",
    partyWord: "customer",
    paidHeading: "Payment received now",
    paidAmountLabel: "Amount received ₹",
    ledgerLabel: "Deposit to",
    saveLabel: "Save invoice",
    priceKey: "salePrice",
  },
  purchase: {
    title: "New Purchase",
    numberLabel: "Bill no.",
    partyLabel: "Bill from",
    partyWord: "supplier",
    paidHeading: "Payment made now",
    paidAmountLabel: "Amount paid ₹",
    ledgerLabel: "Paid from",
    saveLabel: "Save bill",
    priceKey: "purchasePrice",
  },
  estimate: {
    title: "New Estimate",
    numberLabel: "Estimate no.",
    partyLabel: "Estimate for",
    partyWord: "customer",
    paidHeading: "",
    paidAmountLabel: "",
    ledgerLabel: "",
    saveLabel: "Save estimate",
    priceKey: "salePrice",
  },
  "sales-order": {
    title: "New Sales Order",
    numberLabel: "Order no.",
    partyLabel: "Order from",
    partyWord: "customer",
    paidHeading: "",
    paidAmountLabel: "",
    ledgerLabel: "",
    saveLabel: "Save order",
    priceKey: "salePrice",
  },
  "delivery-note": {
    title: "New Delivery Challan",
    numberLabel: "Challan no.",
    partyLabel: "Deliver to",
    partyWord: "customer",
    paidHeading: "",
    paidAmountLabel: "",
    ledgerLabel: "",
    saveLabel: "Save challan",
    priceKey: "salePrice",
  },
  "purchase-order": {
    title: "New Purchase Order",
    numberLabel: "PO no.",
    partyLabel: "Order to",
    partyWord: "supplier",
    paidHeading: "",
    paidAmountLabel: "",
    ledgerLabel: "",
    saveLabel: "Save order",
    priceKey: "purchasePrice",
  },
} as const;

type Paid = "none" | "partial" | "full";

export function InvoiceForm({
  kind,
  initialPartyId,
  editing,
  source,
}: {
  kind: InvoiceKind;
  initialPartyId?: string;
  /** A saved bill to edit. Number and date stay; money received now isn't asked again. */
  editing?: Voucher;
  /** An estimate / order to turn into this voucher: party and items are filled in from it. */
  source?: Voucher;
}) {
  const text = TEXT[kind];
  const attachments = useFinancialAttachments(editing?.id);
  const isOrder = isOrderType(kind);
  /** Sale side (customer, sale price) or purchase side (supplier, purchase price). */
  const side: "sale" | "purchase" =
    kind === "purchase" || kind === "purchase-order" ? "purchase" : "sale";
  const createOrder = useCreateOrder(
    isOrder ? (kind as OrderType) : "estimate",
  );
  const prefill = editing ?? source;
  const [version] = useState(editing?.version);
  const [associates, setAssociates] = useState<InvoiceAssociatesInput>({});
  const [creditReason, setCreditReason] = useState("");
  const approveCredit = useApproveSaleCredit();
  const updateInvoice = useUpdateInvoice(editing?.id ?? "", version);

  // ---- Data -------------------------------------------------------------------
  const firm = useFirm();
  const gst = useGstMode();
  // An edit keeps the GST treatment the bill was saved with
  const taxMode = editing ? voucherMode(editing) : gst.mode;
  const [withoutGst, setWithoutGst] = useState(
    (editing && bookScopeOf(editing) === "nongst") || taxMode === "off",
  );
  const [lotLine, setLotLine] = useState<number | null>(null);
  const [confirmSplit, setConfirmSplit] = useState(false);
  const parties = useParties(side === "sale" ? "customer" : "supplier");
  const items = useItems();
  const ledgers = useLedgers();
  const { role } = useData();
  // Selected stock determines the book category and whether two invoices are needed.
  const createSale = useCreateSales();
  const createPurchase = useCreatePurchase();
  const saving =
    approveCredit.isPending ||
    createSale.isPending ||
    createPurchase.isPending ||
    updateInvoice.isPending ||
    createOrder.isPending;

  // ---- Form state ---------------------------------------------------------------
  const [partyId, setPartyId] = useState<string | undefined>(
    prefill?.partyId ?? initialPartyId,
  );
  const [date, setDate] = useState(editing?.date ?? today());
  const stock = useStockLots(date);
  const lotsFor = (itemId: string) =>
    (stock.data ?? []).filter((lot) => lot.itemId === itemId);
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(
    editing?.supplierInvoiceNo ?? "",
  );
  const [lines, setLines] = useState<LineDraft[]>(
    prefill ? invoiceDrafts(prefill, !!editing) : [],
  );
  const editFreight = prefill?.charges?.find((c) => c.name === "Freight");
  const [freight, setFreight] = useState(
    editFreight ? String(editFreight.amount / 100) : "",
  );
  const [paid, setPaid] = useState<Paid>("none");
  const [paidText, setPaidText] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [bankId, setBankId] = useState("");
  const [picker, setPicker] = useState<"party" | "item" | "bank" | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const party = parties.data?.find((r) => r.party.id === partyId);
  const partyDetail = useParty(partyId ?? "");
  const itemById = (id: string) =>
    items.data?.find((r) => r.item.id === id)?.item;
  const itemFor = (line: LineDraft) =>
    invoiceDraftItem(line.itemId, itemById(line.itemId), editing);
  const savedParty = editing?.snapshot?.party;
  const issuedParty =
    savedParty && savedParty.id === partyId ? savedParty : party?.party;
  const issuedFirm = editing?.snapshot?.firm ?? firm.data;
  const interState =
    !!issuedParty &&
    !!issuedFirm &&
    issuedParty.stateCode !== issuedFirm.stateCode;

  // ---- Maths (pure functions from @repo/core) -----------------------------------
  const rawLines: InvoiceLine[] = lines.map((l) => {
    const lot = lotsFor(l.itemId).find((row) => row.id === l.stockLotId);
    const bookScope =
      side === "purchase" ? (withoutGst ? "nongst" : "gst") : lot?.bookScope;
    return invoiceDraftLine(l, itemFor(l), bookScope);
  });
  // Composition sales and firms without GST: no GST on the bill
  const invoiceLines = applyGstMode(rawLines, taxMode, side);
  const carriesGst =
    billsCarryGst(taxMode, side) &&
    (side === "purchase"
      ? !withoutGst
      : invoiceLines.some((l) => l.bookScope !== "nongst"));
  const freightPaise = parseRupees(freight) ?? 0;
  const charges: ExtraCharge[] = applyGstMode(
    invoiceDraftCharges(freightPaise, prefill?.charges),
    carriesGst ? taxMode : "off",
    side,
  );
  let totals = calcInvoice({ lines: invoiceLines, charges, interState });
  // Estimates and orders may hold any goods; only bills split non-GST goods off
  const mixed =
    kind === "sale" &&
    invoiceLines.some((l) => l.bookScope === "gst") &&
    invoiceLines.some((l) => l.bookScope === "nongst");
  const splitTotals = (["gst", "nongst"] as const).map((scope, index) =>
    calcInvoice({
      lines: invoiceLines.filter((l) => l.bookScope === scope),
      charges: index === 0 ? charges : [],
      interState,
    }),
  );
  if (mixed)
    totals = {
      ...totals,
      grandTotal: splitTotals[0].grandTotal + splitTotals[1].grandTotal,
      roundOff: splitTotals[0].roundOff + splitTotals[1].roundOff,
    };
  const noGstBill =
    side === "purchase"
      ? withoutGst
      : invoiceLines.length > 0 &&
        invoiceLines.every((l) => l.bookScope === "nongst");
  const docType =
    kind === "sale" && !mixed
      ? noGstBill
        ? "invoice"
        : saleDocFor(taxMode, invoiceLines)
      : undefined;
  const nextNumber = useNextNumber(
    kind,
    noGstBill
      ? "nongst"
      : taxMode === "regular" && docType === "bill-of-supply"
        ? "bos"
        : undefined,
    date,
  );
  const modeProblem = party ? modeBlocker(taxMode, side, interState) : null;
  const paidNow =
    paid === "none"
      ? 0
      : paid === "full"
        ? totals.grandTotal
        : (parseRupees(paidText) ?? 0);
  const stockProblem =
    (kind === "sale" || kind === "delivery-note") &&
    (stock.isError
      ? "Could not load stock. Try again."
      : stock.isPending
        ? "Loading stock..."
        : lines.some((l) => !l.stockLotId)
          ? "Choose stock for each item."
          : undefined);
  const problem =
    stockProblem ||
    checkInvoice({
      kind: side,
      partyId,
      lines: invoiceLines,
      grandTotal: totals.grandTotal,
      paidNow,
    });

  // Preview of the Dr/Cr lines this invoice will post.
  const postings = voucherPostings(
    {
      id: "draft",
      type: kind,
      number: "",
      date,
      status: "draft",
      taxMode,
      lines: invoiceLines,
      charges,
      interState,
      amount: totals.grandTotal,
      createdAt: "",
    },
    {
      party: party?.party.name ?? (side === "sale" ? "Customer" : "Supplier"),
    },
  );

  // ---- Actions ------------------------------------------------------------------
  const addItem = (item: Item) =>
    setLines((prev) => [
      ...prev,
      {
        key: Date.now(),
        itemId: item.id,
        stockLotId:
          lotsFor(item.id).filter((l) => l.qty > 0).length === 1
            ? lotsFor(item.id).find((l) => l.qty > 0)?.id
            : undefined,
        qty: "1",
        rate: (item[text.priceKey] / 100).toFixed(2),
        discountPercent: "",
        inAlt: false,
      },
    ]);

  // Coming back from "Add new customer / item": select what was just created.
  const [newItemId, setNewItemId] = useState<string | undefined>();
  useFocusEffect(
    useCallback(() => {
      const p = takePicked("party");
      if (p) setPartyId(p);
      const i = takePicked("item");
      if (i) setNewItemId(i);
    }, []),
  );
  useEffect(() => {
    const item = newItemId ? itemById(newItemId) : undefined;
    if (item) {
      addItem(item);
      setNewItemId(undefined);
    }
    // itemById reads items.data, which refreshes after saving
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newItemId, items.data]);
  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  /**
   * Switch a line between the base unit and the second unit (e.g. Pcs ↔ Box).
   * The rate is converted so the line total stays the same: 12 Pcs × ₹195 ↔ 1 Box × ₹2,340.
   */
  const toggleAlt = (l: LineDraft, item: Item, inAlt: boolean) => {
    const factor = invoiceDraftUnit(l, item)?.factor ?? 1;
    const qty = Number(l.qty) || 0;
    const rate = parseRupees(l.rate) ?? 0;
    if (inAlt) {
      const boxes = qty >= factor && qty % factor === 0 ? qty / factor : 1;
      updateLine(l.key, {
        inAlt,
        qty: String(boxes),
        rate: ((rate * factor) / 100).toFixed(2),
      });
    } else {
      updateLine(l.key, {
        inAlt,
        qty: String(qty * factor || 1),
        rate: (rate / factor / 100).toFixed(2),
      });
    }
  };
  const removeLine = (key: number) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  const save = async (confirmed = false) => {
    setShowErrors(true);
    if (problem || !partyId) return;
    if (mixed && !editing && !confirmed) {
      setConfirmSplit(true);
      return;
    }
    setConfirmSplit(false);
    const ledgerId =
      mode === "cash"
        ? (ledgers.data?.find((row) => row.ledger.kind === "cash")?.ledger.id ??
          "")
        : bankId;
    if (paidNow > 0 && !ledgerId) {
      showError(
        "Couldn't save",
        new Error("Choose an account for the payment."),
      );
      return;
    }
    const base = {
      ...(side === "sale" ? associates : {}),
      partyId,
      date,
      bookScope:
        side === "purchase"
          ? withoutGst
            ? ("nongst" as const)
            : ("gst" as const)
          : undefined,
      supplierInvoiceNo:
        kind === "purchase" ? supplierInvoiceNo || undefined : undefined,
    };
    try {
      if (editing) {
        if (mixed) {
          showError("Can't save", NON_GST_MIX_MESSAGE);
          return;
        }
        const sale = {
          ...base,
          date: editing.date,
          lines: invoiceLines,
          charges,
        };
        const approval =
          kind === "sale" && needsCreditApproval && creditReason.trim()
            ? await approveCredit.mutateAsync({
                sale,
                reason: creditReason.trim(),
                editVoucherId: editing.id,
                editVersion: version!,
              })
            : undefined;
        await updateInvoice.mutateAsync({
          ...sale,
          creditOverrideId: approval?.id,
        });
        await attachments.attachTo(editing.id);
        router.replace(`/voucher/${editing.id}`);
        return;
      }
      if (isOrder) {
        const saved = await attachments.save(
          `/orders/${kind as OrderType}`,
          {
            partyId,
            date,
            lines: invoiceLines,
            charges,
            sourceId: source?.id,
            ...associates,
          },
          createOrder.mutateAsync,
        );
        router.replace(`/voucher/${saved.id}`);
        return;
      }
      if (kind === "sale") {
        const sale = {
          ...base,
          sourceId: source?.id,
          lines: invoiceLines,
          charges,
          paidNow:
            paidNow > 0 ? { amount: paidNow, mode, ledgerId } : undefined,
        };
        const approval =
          needsCreditApproval && creditReason.trim()
            ? await approveCredit.mutateAsync({
                sale,
                reason: creditReason.trim(),
              })
            : undefined;
        const saved = await attachments.save(
          "/sales/split",
          {
            ...sale,
            creditOverrideId: approval?.id,
          },
          createSale.mutateAsync,
          mixed ? 2 : 1,
        );
        router.replace(
          `/voucher/${saved[0].id}${saved[1] ? `?also=${saved[1].id}` : ""}`,
        );
        return;
      }
      {
        const saved = await attachments.save(
          "/purchases",
          {
            ...base,
            sourceId: source?.id,
            lines: invoiceLines,
            charges,
            paidNow:
              paidNow > 0 ? { amount: paidNow, mode, ledgerId } : undefined,
          },
          createPurchase.mutateAsync,
        );
        router.replace(`/voucher/${saved.id}`);
        return;
      }
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  const bank = ledgers.data?.find((l) => l.ledger.id === bankId)?.ledger;
  const detail = partyDetail.data;
  const replacedAmount =
    editing?.partyId === party?.party.id ? (editing?.amount ?? 0) : 0;
  const projectedBalance =
    (party?.balance ?? 0) +
    totals.grandTotal -
    (editing ? replacedAmount : paidNow);
  const needsCreditApproval =
    kind === "sale" &&
    (party?.party.creditLimit ?? 0) > 0 &&
    projectedBalance > (party?.party.creditLimit ?? 0);
  const showCreditWarning =
    kind === "sale" &&
    !!detail &&
    (needsCreditApproval || detail.overLimitBy > 0 || detail.overdueAmount > 0);

  return (
    <Screen
      header={
        <Header
          close
          title={editing ? `Edit ${editing.number}` : text.title}
          subtitle={`${source ? `From ${source.number} · ` : ""}${
            isOrder
              ? kind === "delivery-note"
                ? "Not a bill · stock goes out until it is billed"
                : "Not a bill · no stock, tax or balance change"
              : kind === "purchase"
                ? "Purchase bill"
                : mixed
                  ? "GST bill + Non-GST bill"
                  : docTypeLabel(docType ?? "tax-invoice")
          }${interState && carriesGst ? " · IGST" : ""}`}
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
                : isOrder
                  ? `${text.title.replace("New ", "")} total`
                  : `Balance due ${formatINR(totals.grandTotal - paidNow)}`}
            </Txt>
          </View>
          <Button
            label={
              editing
                ? "Save changes"
                : mixed
                  ? "Save as 2 bills"
                  : text.saveLabel
            }
            variant="primary"
            onPress={() => void save()}
            loading={saving || attachments.busy}
            disabled={showErrors && !!problem}
          />
        </FooterBar>
      }
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label={text.numberLabel}
          value={editing?.number ?? nextNumber.data ?? "…"}
          editable={false}
          mono
        />
        {editing ? (
          <TextField
            label="Date"
            value={formatDate(editing.date)}
            editable={false}
          />
        ) : (
          <DateField
            value={date}
            onChange={setDate}
            min={allowedDates().min}
            max={allowedDates().max}
          />
        )}
      </View>

      <AttachmentPicker {...attachments} />
      {side === "sale" ? (
        <InvoiceAssociates
          value={associates}
          onChange={setAssociates}
          saved={prefill}
        />
      ) : null}
      {kind === "purchase" ? (
        <Checkbox
          label="Purchase without GST"
          checked={withoutGst}
          onChange={editing ? () => {} : setWithoutGst}
        />
      ) : null}
      {/* Party */}
      <View style={{ gap: space.sm }}>
        <SelectField
          label={text.partyLabel}
          value={party?.party.name}
          placeholder={`Pick a ${text.partyWord}`}
          onPress={() => setPicker("party")}
          error={
            showErrors && !partyId ? `Pick a ${text.partyWord}.` : undefined
          }
        />
        {party ? (
          <Txt variant="small" tone="body" num>
            {gst.on ? `${party.party.gstin || "Unregistered"} · ` : ""}
            Balance {formatINR(Math.abs(party.balance))} ·{" "}
            {count(party.party.creditDays, "day")} credit
          </Txt>
        ) : null}
        {showCreditWarning && detail ? (
          <Notice
            text={`${detail.overLimitBy > 0 ? `Over credit limit by ${formatINR(detail.overLimitBy)}. ` : ""}${
              detail.overdueAmount > 0
                ? `${formatINR(detail.overdueAmount)} overdue (oldest ${count(detail.maxOverdueDays, "day")}). `
                : ""
            }Sales above the credit limit need owner approval.`}
          />
        ) : null}
        {needsCreditApproval && role === "owner" ? (
          <TextField
            label="Credit-limit approval reason"
            value={creditReason}
            onChangeText={setCreditReason}
            maxLength={500}
          />
        ) : null}
        {modeProblem ? <Notice text={modeProblem} /> : null}
        {party && firm.data && carriesGst ? (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Txt variant="small" tone="body">
              {side === "sale" ? "Place of supply" : "Supplier state"}
            </Txt>
            <View
              style={{
                flexDirection: "row",
                gap: space.sm,
                alignItems: "center",
              }}
            >
              <Txt variant="small">State {issuedParty?.stateCode}</Txt>
              <Badge label={interState ? "IGST" : "CGST + SGST"} />
            </View>
          </View>
        ) : null}
        {kind === "purchase" ? (
          <View style={{ flexDirection: "row" }}>
            <TextField
              label="Supplier's invoice no."
              value={supplierInvoiceNo}
              onChangeText={setSupplierInvoiceNo}
              placeholder="e.g. JW/1182"
              mono
            />
          </View>
        ) : null}
      </View>

      {/* Items */}
      <View style={{ gap: space.sm }}>
        <Txt variant="heading">Items · {lines.length}</Txt>
        {lines.map((l, i) => {
          const item = itemFor(l);
          const alt = invoiceDraftUnit(l, item);
          const t = calcLine(invoiceLines[i], interState);
          return (
            <Card key={l.key} style={{ gap: space.sm }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                  {item?.name}
                </Txt>
                <IconButton
                  icon="trash-2"
                  label={`Remove ${item?.name ?? "item"}`}
                  onPress={() => removeLine(l.key)}
                />
              </View>
              {item && alt ? (
                <Checkbox
                  label={`Enter quantity in ${alt.unit}`}
                  note={`1 ${alt.unit} = ${alt.factor} ${item.unit}`}
                  checked={l.inAlt}
                  onChange={(on) => toggleAlt(l, item, on)}
                />
              ) : null}
              {kind === "sale" || kind === "delivery-note" ? (
                <SelectField
                  label="Stock lot"
                  value={(() => {
                    const lot = lotsFor(l.itemId).find(
                      (row) => row.id === l.stockLotId,
                    );
                    return lot
                      ? `${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.number} | ${lot.qty} ${item?.unit ?? ""} | Cost ${formatINR(Math.round(lot.unitCost))}`
                      : undefined;
                  })()}
                  placeholder="Choose purchase stock"
                  onPress={() => setLotLine(l.key)}
                />
              ) : null}
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <TextField
                  label={`Qty (${l.inAlt && alt ? alt.unit : (item?.unit ?? "")})`}
                  value={l.qty}
                  keyboardType="decimal-pad"
                  onChangeText={(qty) =>
                    updateLine(l.key, { qty: quantityInput(qty) })
                  }
                />
                <AmountField
                  label={l.inAlt && alt ? `Rate ₹ / ${alt.unit}` : "Rate ₹"}
                  value={l.rate}
                  onChangeText={(rate) => updateLine(l.key, { rate })}
                />
                {l.discountAmount !== undefined ? (
                  <AmountField
                    label="Discount ₹"
                    value={l.discountAmount}
                    onChangeText={(discountAmount) =>
                      updateLine(l.key, { discountAmount })
                    }
                  />
                ) : (
                  <TextField
                    label="Disc %"
                    value={l.discountPercent}
                    keyboardType="decimal-pad"
                    onChangeText={(d) =>
                      updateLine(l.key, {
                        discountPercent: d.replace(/[^0-9.]/g, ""),
                      })
                    }
                  />
                )}
              </View>
              {l.inAlt && item && alt ? (
                <Txt variant="caption" tone="body" num>
                  {lineQtyText(invoiceLines[i], item.unit).main} ={" "}
                  {lineQtyText(invoiceLines[i], item.unit).base} ·{" "}
                  {formatINR(
                    Math.round((parseRupees(l.rate) ?? 0) / alt.factor),
                  )}{" "}
                  per {item.unit}
                </Txt>
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingTop: space.sm,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairlineSoft,
                }}
              >
                <Txt variant="caption" tone="body" num>
                  {!carriesGst
                    ? `${formatINR(t.taxable)}`
                    : invoiceLines[i].taxType === "taxable"
                      ? `Taxable ${formatINR(t.taxable)} · GST ${invoiceLines[i].gstRate}% ${formatINR(t.tax)}`
                      : `${taxTypeLabel(invoiceLines[i].taxType!)} · no GST`}
                </Txt>
                <Money
                  value={t.total}
                  variant="small"
                  style={{ fontWeight: "600" }}
                />
              </View>
            </Card>
          );
        })}
        {mixed ? (
          <Notice text="GST and non-GST stock: two separately numbered bills." />
        ) : null}
        <Button
          label="Add item"
          icon="plus"
          onPress={() => setPicker("item")}
          style={{ borderStyle: "dashed", borderColor: colors.mute }}
        />
      </View>

      {/* Charges and totals */}
      <View style={{ flexDirection: "row" }}>
        <AmountField
          label={carriesGst ? "Freight ₹ (GST 18%)" : "Freight ₹"}
          value={freight}
          onChangeText={setFreight}
        />
      </View>

      <Card style={{ gap: 0 }}>
        <KeyValue
          label={carriesGst ? "Taxable value" : "Sub total"}
          value={formatINR(totals.taxable)}
        />
        {!carriesGst ? null : interState ? (
          <KeyValue label="IGST" value={formatINR(totals.igst)} />
        ) : (
          <>
            <KeyValue label="CGST" value={formatINR(totals.cgst)} />
            <KeyValue label="SGST" value={formatINR(totals.sgst)} />
          </>
        )}
        <KeyValue label="Round off" value={formatINR(totals.roundOff)} />
        <KeyValue
          label={
            isOrder ? "Total" : kind === "sale" ? "Invoice total" : "Bill total"
          }
          value={formatINR(totals.grandTotal)}
          strong
        />
        <Txt variant="caption" tone="body" style={{ paddingTop: space.sm }}>
          {amountInWords(totals.grandTotal)}
        </Txt>
      </Card>

      {/* Money received or paid now (not when editing: record payments separately) */}
      <View
        style={{ gap: space.md, display: editing || isOrder ? "none" : "flex" }}
      >
        <Txt variant="heading">{text.paidHeading}</Txt>
        <Segmented
          value={paid}
          onChange={setPaid}
          options={[
            { value: "none", label: "Not paid" },
            { value: "partial", label: "Partial" },
            { value: "full", label: "Full" },
          ]}
        />
        {paid !== "none" ? (
          <>
            {paid === "partial" ? (
              <View style={{ flexDirection: "row" }}>
                <AmountField
                  label={text.paidAmountLabel}
                  value={paidText}
                  onChangeText={setPaidText}
                />
              </View>
            ) : null}
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
                  label={text.ledgerLabel}
                  value={bank?.name}
                  onPress={() => setPicker("bank")}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {lines.length > 0 && !isOrder ? <PostingTable rows={postings} /> : null}

      {/* Pickers */}
      <Modal
        visible={confirmSplit}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmSplit(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: space.lg,
            backgroundColor: "#00000066",
          }}
        >
          <Card
            style={{
              gap: space.md,
              width: "100%",
              maxWidth: 440,
              alignSelf: "center",
            }}
          >
            <Txt variant="heading">Create two invoices?</Txt>
            {attachments.files.length ? (
              <Txt variant="small">
                Each selected attachment will be linked to both invoices.
              </Txt>
            ) : null}
            <KeyValue
              label="GST invoice"
              value={formatINR(splitTotals[0].grandTotal)}
            />
            <KeyValue
              label="Non-GST invoice"
              value={formatINR(splitTotals[1].grandTotal)}
            />
            <Button
              label="Create both invoices"
              variant="primary"
              onPress={() => void save(true)}
            />
            <Button label="Back" onPress={() => setConfirmSplit(false)} />
          </Card>
        </View>
      </Modal>
      <PickerSheet
        visible={lotLine !== null}
        title="Choose stock lot"
        onClose={() => setLotLine(null)}
        onSelect={(id) => {
          if (lotLine !== null) updateLine(lotLine, { stockLotId: id });
          setLotLine(null);
        }}
        options={lotsFor(lines.find((l) => l.key === lotLine)?.itemId ?? "")
          .filter(
            (lot) =>
              lot.qty > 0 ||
              editing?.lines?.some((l) => l.stockLotId === lot.id),
          )
          .map((lot) => ({
            id: lot.id,
            title: `${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.number}`,
            subtitle: `${lot.date === "0001-01-01" ? "Opening" : formatDate(lot.date)} | ${lot.qty} ${itemById(lot.itemId)?.unit ?? ""} available`,
            right: <Money value={Math.round(lot.unitCost)} variant="small" />,
          }))}
      />
      <PickerSheet
        visible={picker === "party"}
        title={`Pick ${text.partyWord}`}
        searchPlaceholder={`Search ${text.partyWord}s`}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setPartyId(id);
          setPicker(null);
        }}
        addLabel={`Add new ${text.partyWord}`}
        onAdd={() => {
          setPicker(null);
          router.push(
            `/party/new?type=${side === "sale" ? "customer" : "supplier"}&pick=1`,
          );
        }}
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
        visible={picker === "item"}
        title="Add item"
        searchPlaceholder="Search name, code or HSN"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          const item = itemById(id);
          if (item) addItem(item);
          setPicker(null);
        }}
        addLabel="Add new item"
        onAdd={() => {
          setPicker(null);
          router.push("/item/new?pick=1");
        }}
        options={(items.data ?? []).map((r) => ({
          id: r.item.id,
          title: r.item.name,
          subtitle: `${formatQty(r.item, r.qty)} in stock${
            !carriesGst
              ? ""
              : itemTaxType(r.item) === "taxable"
                ? ` · GST ${r.item.gstRate}%`
                : ` · ${taxTypeLabel(itemTaxType(r.item))}`
          }`,
          right: <Money value={r.item[text.priceKey]} variant="small" />,
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
