/** Sale and purchase invoices, including split GST / non-GST sales and order conversion. */
import { storedCustomValues } from "../customFields";
import {
  applyGstMode,
  gstModeOf,
  modeBlocker,
  saleDocFor,
  sideOf,
} from "../accounting/gstMode";
import {
  allocateBillDiscount,
  calcInvoice,
  splitBillDiscount,
} from "../accounting/invoice";
import { resolveCharges } from "../accounting/chargeHeads";
import { checkInvoiceNumbers } from "../accounting/invoiceValidation";
import {
  assertLotsAvailable,
  purchaseLineCost,
  selectStockLines,
  stockLotsFor,
} from "../accounting/stockLots";
import { saleMargin, type SaleMargin } from "../accounting/saleMargin";
import { bookScopeOf } from "../accounting/bookScope";
import { checkSupplierInvoice } from "../accounting/supplierInvoices";
import { tracksStock } from "../accounting/stockInputs";
import { belowMinimum, belowMinimumMessage } from "../accounting/stockPolicy";
import {
  itemTaxType,
  mixesNonGst,
  NON_GST_MIX_MESSAGE,
  UNREGISTERED_SUPPLIER_GST_MESSAGE,
} from "../accounting/taxType";
import { captureVoucherSnapshot } from "../accounting/voucherSnapshot";
import { addDays } from "../dates";
import type {
  BillDiscountInput,
  ExtraCharge,
  GstMode,
  ID,
  ISODate,
  InvoiceLine,
  NewInvoiceInput,
  Voucher,
  VoucherType,
} from "../types";
import type { CreateOptions, Db } from "./base";
import { findParty, logAudit, newId, takeNumber } from "./base";
import { createPayment, createReceipt } from "./moneyEntries";
import { convertBlocker } from "./orders";
// ---------------------------------------------------------------------------
// Sale and purchase invoices
// ---------------------------------------------------------------------------

export function createSale(
  db: Db,
  input: NewInvoiceInput,
  options: CreateOptions = {},
): Voucher {
  return createInvoice(db, "sale", input, options);
}

export function createPurchase(
  db: Db,
  input: NewInvoiceInput,
  options: CreateOptions = {},
): Voucher {
  return createInvoice(db, "purchase", input, options);
}

/** Save split sales, receipts and numbers as one operation, including in demo mode. */
export function createSales(
  db: Db,
  input: NewInvoiceInput,
  options: CreateOptions = {},
): Voucher[] {
  // All or nothing: work on copies of what these saves change (new vouchers,
  // counters, audit lines and the converted source), not a clone of the whole book.
  const draft: Db = {
    ...db,
    vouchers: db.vouchers.map((v) =>
      v.id === input.sourceId ? structuredClone(v) : v,
    ),
    counters: { ...db.counters },
    auditLog: [...db.auditLog],
  };
  const selected = selectStockLines(
    draft.items,
    stockForInvoice(draft, input),
    input.lines.map((l) => withPacking(draft, l)),
    input.date,
    serviceScopeOf(draft),
  );
  const scopes = (["gst", "nongst"] as const).filter((scope) =>
    selected.some((l) => l.bookScope === scope),
  );
  if (scopes.length > 1 && input.sourceId)
    throw new Error(
      "Split this mixed order into separate orders before conversion.",
    );
  let remaining = input.paidNow?.amount ?? 0;
  // A subtotal discount is shared by the bills by value (a percentage applies to each).
  const discounts = splitBillDiscount(
    input.billDiscount,
    scopes.map((scope) => selected.filter((l) => l.bookScope === scope)),
  );
  const saved = scopes.map((bookScope, index) => {
    const voucher = createInvoice(
      draft,
      "sale",
      {
        ...input,
        bookScope,
        lines: selected.filter((l) => l.bookScope === bookScope),
        charges: index === 0 ? input.charges : [],
        billDiscount: discounts[index],
        paidNow: undefined,
      },
      options,
    );
    const amount = Math.min(remaining, voucher.amount);
    if (input.paidNow && amount > 0)
      createReceipt(
        draft,
        {
          ...input.paidNow,
          amount,
          partyId: input.partyId,
          date: input.date,
          bookScope,
          allocations: [{ voucherId: voucher.id, amount }],
        },
        options,
      );
    remaining -= amount;
    return voucher;
  });
  if (remaining > 0) throw new Error("The payment exceeds the invoice totals.");
  Object.assign(db, draft);
  return saved;
}

/** The book of a service line that names none: non-GST for firms without GST. */
export const serviceScopeOf = (db: Db) =>
  gstModeOf(db.firm) === "off" ? ("nongst" as const) : ("gst" as const);

/** A converted challan releases its stock to the replacement invoice. */
export function stockForInvoice(
  db: Db,
  input: Pick<NewInvoiceInput, "sourceId">,
  excludeId?: string,
) {
  return db.vouchers.filter(
    (v) =>
      v.id !== excludeId &&
      !(v.id === input.sourceId && v.type === "delivery-note"),
  );
}

/** A sale being made, for its profit margin (doc 37, T12). */
export interface SaleMarginInput {
  date: ISODate;
  /** Each line may name its book (GST / non-GST) or a stock batch. */
  lines: InvoiceLine[];
  /** The order or challan the sale is made from. */
  sourceId?: ID;
  /** A saved sale being edited: its own stock is free for the new lines. */
  editingId?: ID;
  /** The subtotal discount (T09); it lowers each line's taxable value. */
  billDiscount?: BillDiscountInput;
}

/**
 * Profit margin of a sale not yet saved, from the stock saving it would take:
 * the same lots, oldest first, as createSales (or updateInvoice for an edit).
 */
export function draftSaleMargin(db: Db, input: SaleMarginInput): SaleMargin {
  const editing = input.editingId
    ? db.vouchers.find((v) => v.id === input.editingId && v.type === "sale")
    : undefined;
  if (input.editingId && !editing) throw new Error("Bill not found");
  const lines = input.lines.map((l, index) => {
    if (!editing) return l;
    // As in updateInvoice: a row keeps its saved batch while it is the same item.
    const saved = editing.lines?.[index];
    const stockLotId =
      l.stockLotId ??
      (saved?.itemId === l.itemId ? saved.stockLotId : undefined);
    return {
      ...l,
      stockLotId,
      bookScope: stockLotId ? l.bookScope : bookScopeOf(editing),
    };
  });
  const lots = stockLotsFor(
    db.items,
    stockForInvoice(db, input, editing?.id),
    input.date,
  ).flat();
  // The subtotal discount is shared over the lines as when the sale is saved,
  // so the margin is on the same taxable value.
  return saleMargin(
    lots,
    allocateBillDiscount(lines, input.billDiscount).lines,
    (line) => savedLineDetails(db, line, editing?.lines ?? []),
  );
}

/**
 * A line entered in the item's second unit (e.g. Box) must match the item master.
 * The factor is copied from the item, so the app can't send a wrong one.
 */
function withPacking(db: Db, line: InvoiceLine): InvoiceLine {
  if (!line.per) return line;
  const item = db.items.find((i) => i.id === line.itemId);
  if (!item?.altUnit || item.altUnit.name !== line.per.unit) {
    throw new Error(
      `${item?.name ?? "This item"} isn't sold by the ${line.per.unit}.`,
    );
  }
  return {
    ...line,
    per: { unit: item.altUnit.name, factor: item.altUnit.factor },
  };
}

/** Tax type and GST rate always come from the item master, not from the app. */
function withTax(db: Db, line: InvoiceLine): InvoiceLine {
  const item = db.items.find((i) => i.id === line.itemId);
  if (!item) throw new Error("Item not found");
  const taxType = itemTaxType(item);
  return {
    ...line,
    taxType,
    gstRate: taxType === "taxable" ? item.gstRate : 0,
  };
}

/**
 * Lines and charges of a bill, with GST as the firm's mode allows on this side:
 * composition sales and every bill of a firm without GST carry no GST.
 */
export function billParts(
  db: Db,
  type: VoucherType,
  mode: GstMode,
  input: Pick<
    NewInvoiceInput,
    "lines" | "charges" | "bookScope" | "billDiscount"
  >,
  previousLines: InvoiceLine[] = [],
  previousCharges: ExtraCharge[] = [],
) {
  const side = sideOf(type) ?? "sale";
  // Batch and expiry belong to goods bought (doc 37, T38).
  const keepBatch = (line: InvoiceLine): InvoiceLine => {
    if (
      type === "purchase" &&
      tracksStock(db.items.find((i) => i.id === line.itemId))
    )
      return {
        ...line,
        batchNumber: line.batchNumber?.trim() || undefined,
        expiryDate: line.expiryDate || undefined,
      };
    const { batchNumber: _b, expiryDate: _e, ...rest } = line;
    void [_b, _e];
    return rest;
  };
  const lines: InvoiceLine[] = applyGstMode(
    input.lines.map((line) =>
      keepBatch(savedLineDetails(db, line, previousLines)),
    ),
    mode,
    side,
  ).map((l) => ({
    ...(input.bookScope === "nongst" || l.bookScope === "nongst"
      ? { ...l, gstRate: 0 as const, taxType: "nongst" as const }
      : l),
    // Lines saved now use exact maths; old lines keep theirs until edited.
    exactMath: true,
  }));
  const charges = input.charges
    ? applyGstMode(
        resolveCharges(
          db.invoiceSettings.chargeHeads,
          input.charges,
          side,
          previousCharges,
        ),
        mode,
        side,
      ).map((c) =>
        input.bookScope === "nongst"
          ? {
              ...c,
              gstRate: 0 as const,
              ...(c.taxType ? { taxType: "nongst" as const } : {}),
            }
          : c,
      )
    : undefined;
  // Subtotal discount (doc 37, T09): spread over the lines as saved.
  const discounted = allocateBillDiscount(lines, input.billDiscount);
  checkInvoiceNumbers(discounted.lines, charges);
  return {
    side,
    lines: discounted.lines,
    charges,
    billDiscount: discounted.billDiscount,
  };
}

/** Legacy bills already saved their tax and pack factor, even before master snapshots existed. */
export function savedLineDetails(
  db: Db,
  line: InvoiceLine,
  previousLines: InvoiceLine[],
): InvoiceLine {
  const previous = previousLines.find(
    (saved) =>
      saved.itemId === line.itemId && saved.stockLotId === line.stockLotId,
  );
  const sameUnit = previousLines.find(
    (saved) =>
      saved.itemId === line.itemId &&
      saved.stockLotId === line.stockLotId &&
      saved.per?.unit === line.per?.unit,
  );
  const packed = sameUnit
    ? { ...line, per: sameUnit.per ? { ...sameUnit.per } : undefined }
    : withPacking(db, line);
  return previous
    ? { ...packed, gstRate: previous.gstRate, taxType: previous.taxType }
    : withTax(db, packed);
}

function createInvoice(
  db: Db,
  type: "sale" | "purchase",
  input: NewInvoiceInput,
  options: CreateOptions,
): Voucher {
  if (type === "purchase") checkSupplierInvoice(db.vouchers, input);
  const party = findParty(db, input.partyId);
  if (party.type !== (type === "purchase" ? "supplier" : "customer"))
    throw new Error(
      type === "purchase" ? "Pick a supplier." : "Pick a customer.",
    );
  const interState = party.stateCode !== db.firm.stateCode;
  const mode = gstModeOf(db.firm);
  const selected =
    type === "sale" && !options.legacyStock
      ? selectStockLines(
          db.items,
          stockForInvoice(db, input),
          input.lines.map((l) => withPacking(db, l)),
          input.date,
          serviceScopeOf(db),
        )
      : input.lines;
  const bookScope = options.legacyStock
    ? mode === "off" ||
      selected.every(
        (l) => db.items.find((i) => i.id === l.itemId)?.taxType !== "taxable",
      )
      ? "nongst"
      : "gst"
    : type === "sale"
      ? (selected[0]?.bookScope ?? "gst")
      : (input.bookScope ?? (mode === "off" ? "nongst" : "gst"));
  if (
    type === "sale" &&
    !options.legacyStock &&
    selected.some((l) => l.bookScope !== bookScope)
  )
    throw new Error("Create two separate bills for GST and non-GST stock.");
  const parts = billParts(db, type, mode, {
    ...input,
    bookScope,
    lines: selected.map((l) => ({ ...l, bookScope })),
  });
  const { side, charges, billDiscount } = parts;
  const lines = parts.lines.map((l) =>
    type === "purchase" && tracksStock(db.items.find((i) => i.id === l.itemId))
      ? {
          ...l,
          bookScope,
          stockLotId: newId("lot"),
          stockCost: purchaseLineCost(l, { taxMode: mode, interState }),
        }
      : l,
  );
  const blocked = modeBlocker(mode, side, interState);
  if (blocked) throw new Error(blocked);
  // Only regular firms keep non-GST goods (petrol, liquor) on a separate bill
  if (mode === "regular" && mixesNonGst(lines))
    throw new Error(NON_GST_MIX_MESSAGE);
  const docType =
    type === "sale"
      ? bookScope === "nongst" && !options.legacyStock
        ? "invoice"
        : saleDocFor(mode, lines)
      : undefined;
  const totals = calcInvoice({ lines, charges, interState });
  // New bills only: existing purchases keep what they were saved with.
  if (type === "purchase" && totals.tax > 0 && !party.gstin?.trim())
    throw new Error(UNREGISTERED_SUPPLIER_GST_MESSAGE);
  const customFields = storedCustomValues(
    db.customFieldDefs,
    "voucher",
    input.customFields,
    type,
  );
  const invoice: Voucher = {
    id: newId("v"),
    customFields,
    type,
    number: takeNumber(
      db,
      type,
      input.date,
      bookScope === "nongst" && !options.legacyStock
        ? "nongst"
        : mode === "regular" && docType === "bill-of-supply"
          ? "bos"
          : undefined,
    ),
    date: input.date,
    status: options.status ?? "posted",
    partyId: party.id,
    docType,
    snapshot: captureVoucherSnapshot(db, party.id, lines),
    taxMode: mode,
    bookScope,
    lines,
    charges,
    billDiscount,
    interState,
    dueDate: addDays(input.date, party.creditDays),
    supplierInvoiceNo:
      type === "purchase" ? input.supplierInvoiceNo : undefined,
    amount: totals.grandTotal,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  assertLotsAvailable(
    db.items,
    [...stockForInvoice(db, input), invoice],
    lines.flatMap((l) => (l.stockLotId ? [l.stockLotId] : [])),
  );
  // Stock control (doc 37, T37): "block" refuses a new sale leaving goods under their minimum.
  if (
    type === "sale" &&
    !options.legacyStock &&
    invoice.status === "posted" &&
    db.salesControls?.stockPolicy === "block"
  ) {
    const [short] = belowMinimum(
      db.items,
      [...stockForInvoice(db, input), invoice],
      lines,
    );
    if (short) throw new Error(belowMinimumMessage(short));
  }
  if (input.sourceId) markConverted(db, input.sourceId, invoice, party.id);
  db.vouchers.push(invoice);
  logAudit(db, "created", invoice);

  // Money received/paid at the time of the invoice is saved as a separate receipt/payment against it.
  if (
    input.paidNow &&
    input.paidNow.amount > 0 &&
    invoice.status === "posted"
  ) {
    const amount = Math.min(input.paidNow.amount, invoice.amount);
    const money = {
      partyId: party.id,
      date: input.date,
      amount,
      mode: input.paidNow.mode,
      ledgerId: input.paidNow.ledgerId,
      reference: `Against ${invoice.number}`,
      allocations: [{ voucherId: invoice.id, amount }],
      bookScope,
    };
    if (type === "sale") createReceipt(db, money);
    else createPayment(db, money);
  }
  return invoice;
}

/** Mark the source document as converted into `into`. Party must match. */
export function markConverted(
  db: Db,
  sourceId: ID,
  into: Voucher,
  partyId: ID,
) {
  const source = db.vouchers.find((v) => v.id === sourceId);
  if (!source) throw new Error("The estimate / order was not found.");
  const blocker = convertBlocker(db, source, into.type as "sale");
  if (blocker) throw new Error(blocker);
  if (source.partyId !== partyId)
    throw new Error("The bill must be for the same party as the order.");
  source.convertedToId = into.id;
  into.sourceId = source.id;
  logAudit(db, "converted", source, [], `Turned into ${into.number}`);
}
