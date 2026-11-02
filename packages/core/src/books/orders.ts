/** Estimates and orders. */
import { gstModeOf } from "../accounting/gstMode";
import { calcInvoice } from "../accounting/invoice";
import { CONVERTS_TO, isOrderType } from "../accounting/orders";
import { assertLotsAvailable, selectStockLines } from "../accounting/stockLots";
import { captureVoucherSnapshot } from "../accounting/voucherSnapshot";
import { addDays } from "../dates";
import type { NewOrderInput, OrderType, Voucher } from "../types";
import type { CreateOptions, Db } from "./base";
import { findParty, logAudit, newId, takeNumber } from "./base";
import { billParts, markConverted } from "./invoices";
// ---------------------------------------------------------------------------
// Estimates and orders
// ---------------------------------------------------------------------------

/** Why a document can't be turned into `target`, or null if it can. */
export function convertBlocker(
  db: Db,
  source: Voucher,
  target: "sale" | "purchase" | OrderType,
): string | null {
  if (!isOrderType(source.type))
    return "Only estimates and orders can be converted.";
  if (source.status !== "posted") return "This document is cancelled.";
  if (source.convertedToId) {
    const to = db.vouchers.find((v) => v.id === source.convertedToId);
    return `Already turned into ${to?.number ?? "another voucher"}.`;
  }
  if (!CONVERTS_TO[source.type].includes(target))
    return "It can't be turned into that.";
  return null;
}

export function createOrder(
  db: Db,
  type: OrderType,
  input: NewOrderInput,
  options: CreateOptions = {},
): Voucher {
  const party = findParty(db, input.partyId);
  const wantSupplier = type === "purchase-order";
  if ((party.type === "supplier") !== wantSupplier)
    throw new Error(wantSupplier ? "Pick a supplier." : "Pick a customer.");
  const interState = party.stateCode !== db.firm.stateCode;
  const mode = gstModeOf(db.firm);
  const { lines, charges } = billParts(db, type, mode, input);
  if (!lines.length) throw new Error("Add at least one item.");
  if (type === "delivery-note" && !options.legacyStock) {
    const selected = selectStockLines(db.items, db.vouchers, lines, input.date);
    if (selected.some((l) => l.bookScope !== selected[0].bookScope))
      throw new Error("Use separate delivery notes for GST and non-GST stock.");
    lines.splice(0, lines.length, ...selected);
  }
  const totals = calcInvoice({ lines, charges, interState });
  const voucher: Voucher = {
    id: newId("v"),
    type,
    number: takeNumber(db, type, input.date),
    date: input.date,
    status: options.status ?? "posted",
    partyId: party.id,
    taxMode: mode,
    snapshot: captureVoucherSnapshot(db, party.id, lines),
    lines,
    charges,
    interState,
    validUntil:
      type === "estimate"
        ? (input.validUntil ?? addDays(input.date, 15))
        : undefined,
    amount: totals.grandTotal,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  if (type === "delivery-note") {
    voucher.bookScope = lines[0].bookScope;
    assertLotsAvailable(
      db.items,
      [...db.vouchers, voucher],
      lines.flatMap((l) => (l.stockLotId ? [l.stockLotId] : [])),
    );
  }
  if (input.sourceId) markConverted(db, input.sourceId, voucher, party.id);
  db.vouchers.push(voucher);
  logAudit(db, "created", voucher);
  return voucher;
}
