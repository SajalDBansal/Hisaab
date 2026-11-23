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
  CHALLAN_TYPES,
  CHALLAN_TYPE_LABELS,
  challanMovesStock,
  type ChallanType,
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
  UNREGISTERED_SUPPLIER_GST_MESSAGE,
  allocateStock,
  serviceBooks,
  stockShortfallText,
  type BookScope,
  financialYear,
  canSeeCosts,
  roleFlag,
  type CustomFieldValues,
  type SaleMargin,
  type SaleMarginInput,
  exclusiveRate,
  inclusiveRate,
  type BillDiscountInput,
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
  CustomFieldInputs,
} from "@/components";
import {
  useCreatePurchase,
  useCustomFields,
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
  useSalesControls,
  usePartyItems,
  useSaleMargin,
  useInvoiceSettings,
} from "@/data/queries";
import { useDebounced } from "@/data/useDebounced";
import { useOfflineBooks } from "@/data/useOfflineBooks";
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
  lotsWithoutBill,
  stockPartsByLine,
  invoiceDraftCharges,
  headCharges,
  withBillDiscount,
  type LineDraft,
} from "./invoiceDraft";
import { InvoiceExtras } from "./InvoiceExtras";

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
  proforma: {
    title: "New Proforma Invoice",
    numberLabel: "Proforma no.",
    partyLabel: "Bill to",
    partyWord: "customer",
    paidHeading: "",
    paidAmountLabel: "",
    ledgerLabel: "",
    saveLabel: "Save proforma",
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
/** Picker choice that clears a line's lot so stock is taken oldest first. */
const AUTO_LOT = "__auto__";

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
  const customDefs = useCustomFields().data;
  // Header custom fields (doc 37, T07): the bill's own values when editing.
  const [customValues, setCustomValues] = useState<CustomFieldValues>(
    editing?.customFields ?? {},
  );
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
  const salesControls = useSalesControls();
  const overduePolicy = salesControls.data?.overdueSales ?? "warn";
  // Delivery challans (doc 37, T04): a saved challan keeps what it did when issued.
  const challanStock =
    kind === "delivery-note" &&
    (editing
      ? editing.challanStock !== false
      : (salesControls.data?.challanStock ?? true));
  const [challanType, setChallanType] = useState<ChallanType>(
    editing?.challanType ?? "supply",
  );
  const stockPolicy =
    kind === "sale" && !editing
      ? (salesControls.data?.stockPolicy ?? "warn")
      : "warn";
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
  // Sales staff bill at sale prices; purchase costs stay hidden from them.
  const showCosts = canSeeCosts(role);
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
  // The rate on this party's latest bill for each item (doc 37, T11). Supplier
  // rates are costs, so they are asked for only by roles that may see costs.
  const partyItems = usePartyItems(partyId ?? "", side === "sale" || showCosts);
  const lastRate = (itemId: string) =>
    partyItems.data?.rows.find((row) => row.itemId === itemId);
  const [date, setDate] = useState(editing?.date ?? today());
  // A saved bill may move only within its own financial year (its number carries it).
  const dateRange = editing
    ? (() => {
        const year = financialYear(editing.date);
        const open = allowedDates();
        return {
          min: year.start > open.min ? year.start : open.min,
          max: year.end < open.max ? year.end : open.max,
        };
      })()
    : allowedDates();
  const stock = useStockLots(date);
  // An edit may reuse the stock this bill already took.
  // A sale made from a stock-moving challan takes over the stock the challan holds.
  const lotPool = lotsWithoutBill(
    lotsWithoutBill(stock.data ?? [], editing),
    kind === "sale" && source && challanMovesStock(source) ? source : undefined,
  );
  const lotsFor = (itemId: string) =>
    lotPool.filter((lot) => lot.itemId === itemId);
  /** Books (GST / non-GST) that still hold this item on the bill date. */
  const booksFor = (itemId: string) => [
    ...new Set(
      lotsFor(itemId)
        .filter((lot) => lot.qty > 0)
        .map((lot) => lot.bookScope),
    ),
  ];
  const [sellFrom, setSellFrom] = useState<BookScope | undefined>(
    editing ? bookScopeOf(editing) : undefined,
  );
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
  // Discounts and charges (doc 37, T09)
  const chargeHeads = useInvoiceSettings().data?.chargeHeads;
  const [headAmounts, setHeadAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (prefill?.charges ?? [])
        .filter((c) => c.headId)
        .map((c) => [c.headId!, String(c.amount / 100)]),
    ),
  );
  const [discountIn, setDiscountIn] = useState<"percent" | "amount">(
    prefill?.billDiscount && !prefill.billDiscount.percent
      ? "amount"
      : "percent",
  );
  const [discountText, setDiscountText] = useState(
    prefill?.billDiscount?.percent
      ? String(prefill.billDiscount.percent)
      : prefill?.billDiscount
        ? String(prefill.billDiscount.amount / 100)
        : "",
  );
  const billDiscount: BillDiscountInput | undefined =
    discountIn === "percent"
      ? Number(discountText) > 0
        ? { percent: Math.min(Number(discountText), 100) }
        : undefined
      : (parseRupees(discountText) ?? 0) > 0
        ? { amount: parseRupees(discountText)! }
        : undefined;
  // Rates typed with GST included; lines save the rate before GST.
  const [ratesWithGst, setRatesWithGst] = useState(false);
  const [paid, setPaid] = useState<Paid>("none");
  const [paidText, setPaidText] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [bankId, setBankId] = useState("");
  const [picker, setPicker] = useState<
    "party" | "item" | "bank" | "challanType" | null
  >(null);
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
  const usesStock = kind === "sale" || challanStock;
  // Rows without a chosen lot take stock oldest first; an item in both books needs the user's choice.
  const needsBook =
    usesStock &&
    lines.some((l) => !l.stockLotId && booksFor(l.itemId).length > 1);
  const rawLines: InvoiceLine[] = lines.map((l) => {
    const lot = lotsFor(l.itemId).find((row) => row.id === l.stockLotId);
    const bookScope =
      side === "purchase"
        ? withoutGst
          ? "nongst"
          : "gst"
        : (lot?.bookScope ??
          (booksFor(l.itemId).length > 1 ? sellFrom : undefined));
    return invoiceDraftLine(l, itemFor(l), bookScope);
  });
  // Composition sales and firms without GST: no GST on the bill
  const invoiceLines = applyGstMode(rawLines, taxMode, side).map((l) =>
    ratesWithGst && l.gstRate
      ? { ...l, rate: exclusiveRate(l.rate, l.gstRate) }
      : l,
  );
  // The rows the server will save: each lot a line draws on, as in allocateStock.
  let stockError: string | undefined;
  let stockLines = invoiceLines;
  if (usesStock && stock.data && !(needsBook && !sellFrom))
    try {
      stockLines = allocateStock(
        lotPool,
        invoiceLines,
        // Services take no stock (doc 37, T39).
        serviceBooks(
          (items.data ?? []).map((r) => r.item),
          taxMode === "off" ? "nongst" : "gst",
        ),
      ).map((l) =>
        l.bookScope === "nongst"
          ? { ...l, gstRate: 0 as const, taxType: "nongst" as const }
          : l,
      );
    } catch (err) {
      stockError = err instanceof Error ? err.message : String(err);
    }
  stockLines = withBillDiscount(stockLines, billDiscount, kind === "sale");
  const linesByEntry = stockPartsByLine(invoiceLines, stockLines);
  const carriesGst =
    billsCarryGst(taxMode, side) &&
    (side === "purchase"
      ? !withoutGst
      : stockLines.some((l) => l.bookScope !== "nongst"));
  const freightPaise = parseRupees(freight) ?? 0;
  const charges: ExtraCharge[] = applyGstMode(
    [
      ...invoiceDraftCharges(
        freightPaise,
        prefill?.charges?.filter((c) => !c.headId),
      ),
      ...headCharges(
        Object.fromEntries(
          Object.entries(headAmounts).map(([id, t]) => [
            id,
            parseRupees(t) ?? 0,
          ]),
        ),
        chargeHeads,
        side,
        prefill?.charges,
      ),
    ],
    carriesGst ? taxMode : "off",
    side,
  );
  let totals = calcInvoice({ lines: stockLines, charges, interState });
  // Estimates and orders may hold any goods; only bills split non-GST goods off
  const mixed =
    kind === "sale" &&
    stockLines.some((l) => l.bookScope === "gst") &&
    stockLines.some((l) => l.bookScope === "nongst");
  const splitTotals = (["gst", "nongst"] as const).map((scope, index) =>
    calcInvoice({
      lines: stockLines.filter((l) => l.bookScope === scope),
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
      : stockLines.length > 0 &&
        stockLines.every((l) => l.bookScope === "nongst");
  const docType =
    kind === "sale" && !mixed
      ? noGstBill
        ? "invoice"
        : saleDocFor(taxMode, stockLines)
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
    usesStock &&
    (stock.isError
      ? "Could not load stock. Try again."
      : stock.isPending
        ? "Loading stock..."
        : needsBook && !sellFrom
          ? "Choose whether to sell from GST or non-GST stock."
          : stockError);
  // New purchases only, matching the server; existing bills keep what they saved.
  const supplierProblem =
    kind === "purchase" &&
    !editing &&
    party &&
    !party.party.gstin?.trim() &&
    totals.tax > 0
      ? UNREGISTERED_SUPPLIER_GST_MESSAGE
      : undefined;
  const problem =
    stockProblem ||
    supplierProblem ||
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
      lines: stockLines,
      charges,
      interState,
      amount: totals.grandTotal,
      createdAt: "",
    },
    {
      party: party?.party.name ?? (side === "sale" ? "Customer" : "Supplier"),
    },
  );

  // Profit margin (doc 37, T12): on sales only, for roles with the "see profit
  // margin" right (never sales staff), worked out by the server from the stock
  // the sale would take. Asked for once typing pauses; hidden while it loads,
  // while lines are incomplete and offline.
  const showMargin = kind === "sale" && roleFlag(role, "viewProfitMargin");
  const { online } = useOfflineBooks();
  const marginDraft: SaleMarginInput | null =
    showMargin &&
    online &&
    invoiceLines.length > 0 &&
    invoiceLines.every((l) => l.qty > 0 && l.rate > 0)
      ? {
          date,
          lines: invoiceLines,
          sourceId: source?.id,
          editingId: editing?.id,
          billDiscount,
        }
      : null;
  const marginWanted = marginDraft ? JSON.stringify(marginDraft) : "";
  const marginAsked = useDebounced(marginWanted, 500);
  const marginQuery = useSaleMargin(
    marginAsked ? (JSON.parse(marginAsked) as SaleMarginInput) : null,
  );
  const margin: SaleMargin | undefined =
    marginWanted &&
    marginAsked === marginWanted &&
    marginQuery.isSuccess &&
    !marginQuery.isFetching
      ? marginQuery.data
      : undefined;
  const marginText = (row: {
    margin: number | null;
    marginPercent: number | null;
  }) =>
    `${formatINR(row.margin ?? 0)}${
      row.marginPercent === null
        ? ""
        : ` · ${row.marginPercent < 0 ? "−" : ""}${Math.abs(row.marginPercent)}%`
    }`;

  // ---- Actions ------------------------------------------------------------------
  const addItem = (item: Item) =>
    setLines((prev) => [
      ...prev,
      {
        key: Date.now(),
        itemId: item.id,
        qty: "1",
        rate: (
          (ratesWithGst && carriesGst && item.gstRate
            ? inclusiveRate(item[text.priceKey], item.gstRate)
            : item[text.priceKey]) / 100
        ).toFixed(2),
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
      customFields: customValues,
    };
    try {
      if (editing) {
        if (mixed) {
          showError("Can't save", NON_GST_MIX_MESSAGE);
          return;
        }
        const sale = {
          ...base,
          date,
          lines: invoiceLines,
          charges,
          billDiscount,
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
            billDiscount,
            sourceId: source?.id,
            ...(kind === "delivery-note" ? { challanType } : {}),
            ...associates,
            customFields: customValues,
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
          billDiscount,
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
            billDiscount,
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
  const overLimit =
    kind === "sale" &&
    (party?.party.creditLimit ?? 0) > 0 &&
    projectedBalance > (party?.party.creditLimit ?? 0);
  // Under the firm's "block" policy a new sale to a customer with overdue
  // bills needs the owner's approval too (doc 37, T11); edits are not blocked.
  const showOverdue =
    overduePolicy !== "off" && (detail?.overdueAmount ?? 0) > 0;
  const overdueBlocks =
    kind === "sale" && !editing && overduePolicy === "block" && showOverdue;
  const needsCreditApproval = overLimit || overdueBlocks;
  const showCreditWarning =
    kind === "sale" &&
    !!detail &&
    (needsCreditApproval || detail.overLimitBy > 0 || showOverdue);

  return (
    <Screen
      header={
        <Header
          close
          title={editing ? `Edit ${editing.number}` : text.title}
          subtitle={`${source ? `From ${source.number} · ` : ""}${
            isOrder
              ? kind === "delivery-note"
                ? challanStock
                  ? "Not a bill · stock goes out on the challan"
                  : "Not a bill · stock moves on the invoice"
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
        <DateField
          value={date}
          onChange={setDate}
          min={dateRange.min}
          max={dateRange.max}
        />
      </View>

      <CustomFieldInputs
        defs={customDefs}
        entity="voucher"
        voucherType={kind}
        values={customValues}
        onChange={setCustomValues}
      />
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
      {kind === "delivery-note" ? (
        <View style={{ gap: space.sm }}>
          <SelectField
            label="Challan type"
            value={CHALLAN_TYPE_LABELS[challanType]}
            onPress={editing ? () => {} : () => setPicker("challanType")}
          />
          <Txt variant="small" tone="body">
            {challanStock
              ? "This challan takes the goods out of stock; the invoice made from it will not take them again."
              : "Paperwork only: stock moves on the invoice made from this challan."}
          </Txt>
        </View>
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
              showOverdue
                ? `${formatINR(detail.overdueAmount)} overdue (oldest ${count(detail.maxOverdueDays, "day")}). `
                : ""
            }${
              overdueBlocks
                ? "New sales to customers with overdue bills need the owner's approval."
                : "Sales above the credit limit need owner approval."
            }`}
          />
        ) : null}
        {needsCreditApproval && role === "owner" ? (
          <TextField
            label="Owner approval reason"
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
        {carriesGst ? (
          <Checkbox
            label="Rates include GST"
            note="Type the rate with GST; the bill saves the rate before GST, to the paisa."
            checked={ratesWithGst}
            onChange={(on) => {
              // Keep each line total: show the same rate with or without GST.
              setLines((prev) =>
                prev.map((l, i) => {
                  const gstRate = invoiceLines[i]?.gstRate ?? 0;
                  const rate = parseRupees(l.rate) ?? 0;
                  if (!gstRate) return l;
                  const next = on
                    ? inclusiveRate(rate, gstRate)
                    : exclusiveRate(rate, gstRate);
                  return { ...l, rate: (next / 100).toFixed(2) };
                }),
              );
              setRatesWithGst(on);
            }}
          />
        ) : null}
        {needsBook && !editing ? (
          <View style={{ gap: space.xs }}>
            <Txt variant="small" tone="body">
              Some items are in both GST and non-GST stock. Sell from:
            </Txt>
            <Segmented
              value={sellFrom ?? ""}
              onChange={(value) => setSellFrom(value || undefined)}
              options={[
                { value: "gst", label: "GST stock" },
                { value: "nongst", label: "Non-GST stock" },
              ]}
            />
          </View>
        ) : null}
        {lines.map((l, i) => {
          const item = itemFor(l);
          const alt = invoiceDraftUnit(l, item);
          // A line drawing on several lots is several saved rows; show their sum.
          const parts = linesByEntry[i]?.length
            ? linesByEntry[i]
            : [invoiceLines[i]];
          const shown = parts[0];
          const t = parts
            .map((part) => calcLine(part, interState))
            .reduce((sum, row) => ({
              ...sum,
              taxable: sum.taxable + row.taxable,
              tax: sum.tax + row.tax,
              total: sum.total + row.total,
            }));
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
              {(kind === "sale" || challanStock) && item?.kind !== "service" ? (
                <SelectField
                  label="Stock lot"
                  value={(() => {
                    const lot = lotsFor(l.itemId).find(
                      (row) => row.id === l.stockLotId,
                    );
                    if (lot)
                      return `${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.number} | ${lot.qty} ${item?.unit ?? ""}${showCosts ? ` | Cost ${formatINR(Math.round(lot.unitCost))}` : ""}`;
                    const used = parts.flatMap((part) => {
                      const from = lotsFor(l.itemId).find(
                        (row) => row.id === part.stockLotId,
                      );
                      return from ? [`${from.number} × ${part.qty}`] : [];
                    });
                    return used.length
                      ? `Oldest first: ${used.join(", ")}`
                      : undefined;
                  })()}
                  placeholder="Oldest first (automatic)"
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
                  label={`${l.inAlt && alt ? `Rate ₹ / ${alt.unit}` : "Rate ₹"}${ratesWithGst && shown?.gstRate ? " incl. GST" : ""}`}
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
              {kind === "purchase" && item && item.kind !== "service" ? (
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <TextField
                    label="Batch (optional)"
                    value={l.batchNumber ?? ""}
                    onChangeText={(batchNumber) =>
                      updateLine(l.key, {
                        batchNumber: batchNumber.slice(0, 40),
                      })
                    }
                    placeholder="e.g. AG2608"
                  />
                  <View style={{ flex: 1 }}>
                    <DateField
                      label="Expiry (optional)"
                      value={l.expiryDate ?? ""}
                      onChange={(expiryDate) =>
                        updateLine(l.key, { expiryDate })
                      }
                    />
                    {l.expiryDate ? (
                      <Txt
                        variant="caption"
                        tone="body"
                        accessibilityRole="button"
                        onPress={() =>
                          updateLine(l.key, { expiryDate: undefined })
                        }
                      >
                        Clear expiry
                      </Txt>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {usesStock && item && item.kind !== "service" && stock.data
                ? (() => {
                    // Stock control (doc 37, T37): warn before the server refuses.
                    const warning = stockShortfallText(
                      item,
                      lotsFor(l.itemId),
                      invoiceLines[i],
                      stockPolicy,
                    );
                    return warning ? <Notice text={warning} /> : null;
                  })()
                : null}
              {(() => {
                const last = lastRate(l.itemId);
                if (!last) return null;
                // With "Rates include GST" on, Use fills the rate with GST.
                const lastTyped =
                  ratesWithGst && shown?.gstRate
                    ? inclusiveRate(last.typedRate, shown.gstRate)
                    : last.typedRate;
                const typed = (lastTyped / 100).toFixed(2);
                const canUse = !l.inAlt && parseRupees(l.rate) !== lastTyped;
                return (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                    }}
                  >
                    <Txt variant="caption" tone="body" num style={{ flex: 1 }}>
                      Last {side === "sale" ? "sold" : "bought"} at{" "}
                      {formatINR(last.typedRate)} / {last.unit} on{" "}
                      {formatDate(last.lastDate)} · {last.lastNumber}
                    </Txt>
                    {canUse ? (
                      <Button
                        label="Use"
                        size="sm"
                        onPress={() => updateLine(l.key, { rate: typed })}
                      />
                    ) : null}
                  </View>
                );
              })()}
              {ratesWithGst && shown?.gstRate ? (
                <Txt variant="caption" tone="body" num>
                  Rate before GST {formatINR(invoiceLines[i].rate)}
                </Txt>
              ) : null}
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
                    : shown.taxType === "taxable"
                      ? `Taxable ${formatINR(t.taxable)} · GST ${shown.gstRate}% ${formatINR(t.tax)}`
                      : `${taxTypeLabel(shown.taxType!)} · no GST`}
                </Txt>
                <Money
                  value={t.total}
                  variant="small"
                  style={{ fontWeight: "600" }}
                />
              </View>
              {(() => {
                const row = margin?.lines[i];
                if (!row || row.margin === null) return null;
                return (
                  <Badge
                    label={`Margin ${marginText(row)}`}
                    tone={row.margin < 0 ? "bad" : "ok"}
                  />
                );
              })()}
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
      <InvoiceExtras
        heads={chargeHeads ?? []}
        saved={prefill?.charges ?? []}
        amounts={headAmounts}
        onAmounts={setHeadAmounts}
        carriesGst={carriesGst}
        discountIn={discountIn}
        onDiscountIn={setDiscountIn}
        discountText={discountText}
        onDiscountText={setDiscountText}
      />

      <Card style={{ gap: 0 }}>
        {totals.billDiscount ? (
          <>
            <KeyValue
              label="Sub total"
              value={formatINR(totals.taxable + totals.billDiscount)}
            />
            <KeyValue
              label={`Discount${billDiscount?.percent ? ` (${billDiscount.percent}%)` : ""}`}
              value={`−${formatINR(totals.billDiscount)}`}
            />
          </>
        ) : null}
        <KeyValue
          label={
            carriesGst
              ? "Taxable value"
              : totals.billDiscount
                ? "After discount"
                : "Sub total"
          }
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
        {margin && margin.total.margin !== null ? (
          <View
            style={{
              marginTop: space.sm,
              paddingTop: space.xs,
              borderTopWidth: 1,
              borderTopColor: colors.hairlineSoft,
            }}
          >
            <KeyValue
              label="Profit margin"
              value={
                <Txt
                  variant="small"
                  num
                  style={{
                    fontWeight: "600",
                    color: margin.total.margin < 0 ? colors.give : colors.get,
                  }}
                >
                  {marginText(margin.total)}
                </Txt>
              }
            />
            <Txt variant="caption" tone="body">
              On the taxable value of the items, less their stock cost (oldest
              stock first). Not printed.
              {margin.missing > 0
                ? ` Leaves out ${count(margin.missing, "line")} without stock.`
                : ""}
            </Txt>
          </View>
        ) : null}
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
          if (lotLine !== null)
            updateLine(lotLine, {
              stockLotId: id === AUTO_LOT ? undefined : id,
            });
          setLotLine(null);
        }}
        options={[
          {
            id: AUTO_LOT,
            title: "Oldest first (automatic)",
            subtitle: "Uses the oldest stock first, across batches if needed",
          },
          ...lotsFor(lines.find((l) => l.key === lotLine)?.itemId ?? "")
            .filter(
              (lot) =>
                lot.qty > 0 ||
                editing?.lines?.some((l) => l.stockLotId === lot.id),
            )
            .map((lot) => ({
              id: lot.id,
              title: `${lot.bookScope === "gst" ? "GST" : "Non-GST"} | ${lot.number}`,
              subtitle: `${lot.date === "0001-01-01" ? "Opening" : formatDate(lot.date)} | ${lot.qty} ${itemById(lot.itemId)?.unit ?? ""} available`,
              right: showCosts ? (
                <Money value={Math.round(lot.unitCost)} variant="small" />
              ) : undefined,
            })),
        ]}
      />
      <PickerSheet
        visible={picker === "challanType"}
        title="Challan type"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setChallanType(id as ChallanType);
          setPicker(null);
        }}
        options={CHALLAN_TYPES.map((id) => ({
          id,
          title: CHALLAN_TYPE_LABELS[id],
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
        options={(items.data ?? [])
          // Not-for-sale items are bought, never sold (doc 37, T39).
          .filter((r) => side === "purchase" || !r.item.notForSale)
          .map((r) => ({
            id: r.item.id,
            title: r.item.name,
            subtitle: `${r.item.kind === "service" ? "Service" : `${formatQty(r.item, r.qty)} in stock`}${
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
