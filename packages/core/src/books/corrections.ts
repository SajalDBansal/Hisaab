/** Corrections: cancelling, editing and moving bills, and returns (credit / debit notes). */
import { voucherChanges } from "../accounting/audit";
import { bookScopeOf } from "../accounting/bookScope";
import { modeBlocker, saleDocFor, voucherMode } from "../accounting/gstMode";
import { calcInvoice } from "../accounting/invoice";
import { checkInvoiceNumbers } from "../accounting/invoiceValidation";
import { isOrderType } from "../accounting/orders";
import { purchaseReturnLines } from "../accounting/purchaseReturnCost";
import { returnAllocations } from "../accounting/returnAllocations";
import { returnAmountBasis, returnAmounts } from "../accounting/returnAmounts";
import { returnStockCost } from "../accounting/returnStockCost";
import { billAllocations } from "../accounting/settlements";
import { baseQty } from "../accounting/stock";
import {
  assertLotsAvailable,
  purchaseLineCost,
  purchaseLotId,
  selectStockLines,
  stockLots,
} from "../accounting/stockLots";
import { checkSupplierInvoice } from "../accounting/supplierInvoices";
import { mixesNonGst, NON_GST_MIX_MESSAGE } from "../accounting/taxType";
import {
  captureVoucherSnapshot,
  editedVoucherSnapshot,
} from "../accounting/voucherSnapshot";
import { addDays, financialYear, formatDate } from "../dates";
import { formatINR } from "../money";
import { isStoredQuantity } from "../precision";
import type {
  ID,
  InvoiceLine,
  ISODate,
  NewInvoiceInput,
  NewNoteInput,
  Voucher,
} from "../types";
import type { CreateOptions, Db } from "./base";
import { auditNames, findParty, logAudit, newId, takeNumber } from "./base";
import { billParts, savedLineDetails, stockForInvoice } from "./invoices";
// ---------------------------------------------------------------------------
// Corrections: cancel, edit, returns (credit / debit notes)
// ---------------------------------------------------------------------------

/** Posted vouchers (receipts, payments, notes) that settle part of a bill, with the amount. */
function settlementsOf(db: Db, billId: ID) {
  return db.vouchers
    .filter(
      (v) =>
        v.status === "posted" &&
        billAllocations(v).some((a) => a.voucherId === billId),
    )
    .map((v) => ({
      voucher: v,
      amount: billAllocations(v)
        .filter((a) => a.voucherId === billId)
        .reduce((s, a) => s + a.amount, 0),
    }));
}

/** Why a voucher can't be cancelled right now, or null if it can. */
function consumedPurchaseBlocker(db: Db, v: Voucher): string | null {
  if (v.type !== "purchase") return null;
  const ids = (v.lines ?? []).map((_, i) => purchaseLotId(v, i));
  const dependent = db.vouchers.find(
    (x) =>
      x.id !== v.id &&
      x.status === "posted" &&
      x.lines?.some((l) => l.stockLotId && ids.includes(l.stockLotId)),
  );
  if (dependent)
    return `Stock from this purchase is used by ${dependent.number}. Cancel that entry first.`;
  const legacyUse = (v.lines ?? []).some((line, index) => {
    const item = db.items.find((i) => i.id === line.itemId);
    const lot = item
      ? stockLots(item, db.vouchers).find((l) => l.id === ids[index])
      : undefined;
    return lot && lot.minimumQty < baseQty(line);
  });
  return legacyUse
    ? "Stock from this purchase is used by a later entry. Review its sales and returns first."
    : null;
}

function inventoryHistoryBlocker(db: Db, v: Voucher): string | null {
  if (
    ![
      "sale",
      "purchase",
      "credit-note",
      "debit-note",
      "delivery-note",
    ].includes(v.type)
  )
    return null;
  const active = db.vouchers.filter(
    (row) =>
      row.status === "posted" &&
      row.inventoryAdjustment &&
      row.inventoryAdjustment.kind !== "reversal" &&
      !db.vouchers.some(
        (reversal) =>
          reversal.status === "posted" &&
          reversal.inventoryAdjustment?.reversesId === row.id,
      ),
  );
  return active.some(
    (row) =>
      row.date >= v.date &&
      v.lines?.some((line) => line.itemId === row.inventoryAdjustment?.itemId),
  )
    ? "Reverse the later inventory correction for this item before changing its stock history."
    : null;
}

export function cancelBlocker(db: Db, v: Voucher): string | null {
  if (v.settlementLocked)
    return "Use a settlement correction or reversal to retain the allocation history.";
  if (v.inventoryAdjustment)
    return "Use the inventory reversal action to retain the stock correction history.";
  const adjustmentProblem = inventoryHistoryBlocker(db, v);
  if (adjustmentProblem) return adjustmentProblem;
  const stockProblem = consumedPurchaseBlocker(db, v);
  if (stockProblem) return stockProblem;
  if (v.status === "cancelled") return "Already cancelled.";
  if (v.status === "draft") return null;
  if (v.convertedToId) {
    const to = db.vouchers.find((x) => x.id === v.convertedToId);
    return `This was turned into ${to?.number ?? "another voucher"}. Cancel that first.`;
  }
  const returns = db.vouchers.filter(
    (x) => x.status === "posted" && x.againstId === v.id,
  );
  if (returns.length)
    return `This bill has a return (${returns.map((x) => x.number).join(", ")}). Cancel the return first.`;
  const linked = settlementsOf(db, v.id);
  if (linked.length) {
    const list = linked.map((x) => x.voucher.number).join(", ");
    return `${formatINR(linked.reduce((s, x) => s + x.amount, 0))} is settled against this bill by ${list}. Cancel ${linked.length > 1 ? "those" : "that"} first.`;
  }
  return null;
}

/**
 * Cancel a voucher. It keeps its number (so the series has no gaps) but stops counting
 * everywhere: balances, stock, GST and reports.
 */
export function cancelVoucher(
  db: Db,
  id: ID,
  reason: string,
  at: string,
): Voucher {
  const v = db.vouchers.find((x) => x.id === id);
  if (!v) throw new Error("Voucher not found");
  if (!reason.trim()) throw new Error("Give a reason for cancelling.");
  const blocker = cancelBlocker(db, v);
  if (blocker) throw new Error(blocker);
  if (v.type === "credit-note")
    assertLotsAvailable(
      db.items,
      db.vouchers.filter((x) => x.id !== v.id),
      (v.lines ?? []).flatMap((l) => (l.stockLotId ? [l.stockLotId] : [])),
    );
  v.status = "cancelled";
  v.cancelReason = reason.trim();
  v.cancelledAt = at;
  logAudit(db, "cancelled", v, [], v.cancelReason);
  // The estimate / order it came from becomes open again
  const source = db.vouchers.find((x) => x.convertedToId === v.id);
  if (source) {
    source.convertedToId = undefined;
    logAudit(db, "reopened", source, [], `${v.number} was cancelled`);
  }
  return v;
}

/** Why a sale/purchase can't be edited, or null if it can. */
export function editBlocker(db: Db, v: Voucher): string | null {
  if (v.settlementLocked)
    return "Use a settlement correction or reversal to retain the allocation history.";
  const adjustmentProblem = inventoryHistoryBlocker(db, v);
  if (adjustmentProblem) return adjustmentProblem;
  const stockProblem = consumedPurchaseBlocker(db, v);
  if (stockProblem) return stockProblem;
  if (v.type !== "sale" && v.type !== "purchase" && !isOrderType(v.type))
    return "Only bills, estimates and orders can be edited.";
  if (v.status !== "posted") return "Only posted bills can be edited.";
  if (v.convertedToId) return "It was already turned into a bill or order.";
  const returns = db.vouchers.filter(
    (x) => x.status === "posted" && x.againstId === v.id,
  );
  if (returns.length)
    return `This bill has a return (${returns.map((x) => x.number).join(", ")}). Cancel the return first.`;
  return null;
}

/**
 * Why a bill can't move to `date`, or null. The number carries its financial
 * year, so the date stays inside it; money settled against the bill must not
 * come before it; stock corrections already made on or after either date must
 * be reversed first.
 */
export function dateChangeBlocker(
  db: Db,
  v: Voucher,
  date: ISODate,
): string | null {
  if (date === v.date) return null;
  if (financialYear(date).short !== financialYear(v.date).short)
    return `${v.number} belongs to financial year ${financialYear(v.date).short}. Pick a date in that year, or cancel and make a new bill.`;
  const earlier = settlementsOf(db, v.id).filter((s) => s.voucher.date < date);
  if (earlier.length)
    return `${earlier.map((s) => s.voucher.number).join(", ")} settles this bill before ${formatDate(date)}. Choose a date on or before ${formatDate(earlier.map((s) => s.voucher.date).sort()[0])}.`;
  return inventoryHistoryBlocker(db, {
    ...v,
    date: date < v.date ? date : v.date,
  });
}

/**
 * Edit a saved sale or purchase. The number stays; the date may move within its
 * financial year (see dateChangeBlocker).
 * Money already received/paid against it can't be more than the new total.
 */
export function updateInvoice(
  db: Db,
  id: ID,
  input: NewInvoiceInput,
  at: string,
): Voucher {
  const v = db.vouchers.find((x) => x.id === id);
  if (!v) throw new Error("Bill not found");
  const date = input.date ?? v.date;
  if (v.type === "purchase")
    checkSupplierInvoice(db.vouchers, { ...input, date }, id);
  const blocker = editBlocker(db, v) ?? dateChangeBlocker(db, v, date);
  if (blocker) throw new Error(blocker);
  const settled = settlementsOf(db, id).reduce((s, x) => s + x.amount, 0);
  if (input.partyId !== v.partyId && settled > 0)
    throw new Error(
      "Money is already settled against this bill, so the party can't change.",
    );
  const party = findParty(db, input.partyId);
  // An edit keeps the GST treatment the bill was saved with
  const snapshot = editedVoucherSnapshot(db, v.snapshot, party.id, input.lines);
  const interState = snapshot.party!.stateCode !== snapshot.firm.stateCode;
  const historicalBooks = { ...db, items: snapshot.items };
  const mode = voucherMode(v);
  if (input.bookScope && input.bookScope !== bookScopeOf(v))
    throw new Error(
      "Cancel and recreate the bill to change its book category.",
    );
  input = { ...input, bookScope: bookScopeOf(v) };
  const usesStock = v.type === "sale" || v.type === "delivery-note";
  if (usesStock)
    input.lines = selectStockLines(
      db.items,
      stockForInvoice(db, input, v.id),
      input.lines.map((l, index) => {
        // A row keeps its saved batch only while it is still the same item;
        // other rows take stock oldest first from this bill's own book.
        const saved = v.lines?.[index];
        const stockLotId =
          l.stockLotId ??
          (saved?.itemId === l.itemId ? saved.stockLotId : undefined);
        return savedLineDetails(
          historicalBooks,
          {
            ...l,
            stockLotId,
            bookScope: stockLotId ? l.bookScope : bookScopeOf(v),
          },
          v.lines ?? [],
        );
      }),
      date,
    );
  const { side, lines, charges } = billParts(
    historicalBooks,
    v.type,
    mode,
    input,
    v.lines,
  );
  if (!lines.length) throw new Error("Add at least one item.");
  const blocked = modeBlocker(mode, side, interState);
  if (blocked) throw new Error(blocked);
  // Estimates and orders may hold any goods; bills can't mix non-GST goods
  if (mode === "regular" && !isOrderType(v.type) && mixesNonGst(lines))
    throw new Error(NON_GST_MIX_MESSAGE);
  if (usesStock && lines.some((l) => l.bookScope !== bookScopeOf(v)))
    throw new Error(
      "Cancel and recreate the bill to change its stock category.",
    );
  if (v.type === "purchase")
    lines.forEach((l, index) => {
      l.stockLotId = v.lines?.[index]?.stockLotId ?? purchaseLotId(v, index);
      l.bookScope = bookScopeOf(v);
      l.stockCost = purchaseLineCost(l, v);
    });
  const docType =
    v.type === "sale"
      ? bookScopeOf(v) === "nongst" && v.bookScope
        ? "invoice"
        : saleDocFor(mode, lines)
      : undefined;
  if (
    (party.type === "supplier") !==
    (v.type === "purchase" || v.type === "purchase-order")
  )
    throw new Error(
      v.type === "purchase" || v.type === "purchase-order"
        ? "Pick a supplier."
        : "Pick a customer.",
    );
  if (docType !== v.docType && v.type === "sale")
    throw new Error(
      docType === "bill-of-supply"
        ? "With these items this would become a Bill of supply. Cancel this bill and make a new one instead."
        : "With these items this would become a Tax invoice. Cancel this bill and make a new one instead.",
    );
  const amount = calcInvoice({ lines, charges, interState }).grandTotal;
  if (amount < settled)
    throw new Error(
      `${formatINR(settled)} is already settled against this bill; the new total can't be less.`,
    );
  const before = structuredClone(v);
  assertLotsAvailable(
    db.items,
    [...stockForInvoice(db, input, v.id), { ...v, date, lines }],
    lines.flatMap((l) => (l.stockLotId ? [l.stockLotId] : [])),
  );
  Object.assign(v, {
    date,
    partyId: party.id,
    snapshot,
    lines,
    charges,
    interState,
    dueDate: isOrderType(v.type) ? undefined : addDays(date, party.creditDays),
    supplierInvoiceNo:
      v.type === "purchase" ? input.supplierInvoiceNo : undefined,
    amount,
    narration: input.narration,
    editedAt: at,
  });
  logAudit(db, "edited", v, voucherChanges(before, v, auditNames(db)));
  return v;
}

/** Lines of a bill with how much is still left to return (in each line's own unit). */
export function returnableLines(db: Db, billId: ID) {
  const bill = db.vouchers.find((x) => x.id === billId);
  if (!bill || (bill.type !== "sale" && bill.type !== "purchase"))
    throw new Error("Bill not found");
  const notes = db.vouchers.filter(
    (x) => x.status === "posted" && x.againstId === billId,
  );
  return (bill.lines ?? []).map((line, index) => {
    const returnedUnits = notes
      .flatMap((n) => n.lines ?? [])
      .filter((l) => l.sourceLine === index)
      .reduce((s, l) => s + Math.round(l.qty * 1000), 0);
    const returned = returnedUnits / 1000;
    return {
      index,
      line,
      returned,
      returnable: (Math.round(line.qty * 1000) - returnedUnits) / 1000,
    };
  });
}

/**
 * Sales return (credit note) or purchase return (debit note) against a bill.
 * Lines are copied from the bill (same rate, discount, unit and GST), only the quantity changes.
 * The note settles the bill first; anything over what's pending stays as a balance with the party.
 */
export function createNote(
  db: Db,
  type: "credit-note" | "debit-note",
  input: NewNoteInput,
  options: CreateOptions = {},
): Voucher {
  const bill = db.vouchers.find((x) => x.id === input.againstId);
  const wantType = type === "credit-note" ? "sale" : "purchase";
  if (!bill || bill.type !== wantType || bill.status !== "posted")
    throw new Error(`Pick a posted ${wantType} bill to return against.`);
  if (!input.reason.trim()) throw new Error("Pick a reason for the return.");
  if (input.date < bill.date)
    throw new Error("A return can't be dated before its bill.");
  const left = returnableLines(db, bill.id);
  const amountBasis = returnAmountBasis(bill, db.vouchers);
  const seen = new Set<number>();
  const lines: InvoiceLine[] = [];
  for (const r of input.lines) {
    if (seen.has(r.index)) throw new Error("Pick each bill line only once.");
    seen.add(r.index);
    if (!isStoredQuantity(r.qty))
      throw new Error("Use at most 3 decimal places for the return quantity.");
    if (!r.qty) continue;
    const row = left[r.index];
    if (!row) throw new Error("That line isn't on the bill.");
    if (r.qty < 0 || r.qty > row.returnable)
      throw new Error(
        `Only ${row.returnable} left to return on line ${r.index + 1}.`,
      );
    const amounts = returnAmounts(amountBasis[r.index], r.qty);
    const discountAmount = row.line.discountAmount
      ? amounts.discount
      : undefined;
    lines.push({
      ...row.line,
      qty: r.qty,
      stockLotId:
        row.line.stockLotId ??
        (type === "debit-note" ? purchaseLotId(bill, r.index) : undefined),
      stockCost:
        type === "credit-note"
          ? returnStockCost(bill, db.vouchers, r.index, r.qty)
          : undefined,
      discountAmount,
      returnAmounts: amounts,
      sourceLine: r.index,
    });
  }
  if (!lines.length)
    throw new Error("Enter how many came back for at least one item.");
  checkInvoiceNumbers(lines);

  const amount = calcInvoice({
    lines,
    interState: !!bill.interState,
  }).grandTotal;
  const allocations = returnAllocations(bill, db.vouchers, input.date, amount);
  const note: Voucher = {
    id: newId("v"),
    type,
    number: takeNumber(db, type, input.date),
    date: input.date,
    status: options.status ?? "posted",
    partyId: bill.partyId,
    snapshot: structuredClone(
      bill.snapshot ??
        captureVoucherSnapshot(db, bill.partyId, bill.lines, "legacy"),
    ),
    againstId: bill.id,
    noteReason: input.reason.trim(),
    taxMode: bill.taxMode,
    bookScope: bookScopeOf(bill),
    lines,
    interState: bill.interState,
    allocations,
    amount,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  if (type === "debit-note")
    note.lines = purchaseReturnLines(db.items, db.vouchers, note);
  assertLotsAvailable(
    db.items,
    [...db.vouchers, note],
    lines.flatMap((l) => (l.stockLotId ? [l.stockLotId] : [])),
  );
  db.vouchers.push(note);
  logAudit(db, "created", note);
  return note;
}
