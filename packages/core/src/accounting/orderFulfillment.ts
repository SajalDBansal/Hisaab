import type { ExtraCharge, InvoiceLine, OrderType, Voucher } from "../types";
import { isStoredQuantity } from "../precision";
import { calcLine, lineGross } from "./invoice";
import { checkInvoiceNumbers } from "./invoiceValidation";
import { CONVERTS_TO, isOrderType } from "./orders";
import {
  createOrder,
  createPurchase,
  createSale,
  type Db as Books,
} from "../mock/db";
import type { StockLot } from "./stockLots";
import type { CommissionPolicy } from "./associates";
import type { PrintableDelivery } from "../print/associateDelivery";

export type FulfillmentTarget =
  "sale" | "purchase" | "sales-order" | "delivery-note";
export interface FulfillmentInvoiceLine extends InvoiceLine {
  orderLineId?: string;
  orderSourceLineId?: string;
  stockFulfilledById?: string;
}
export interface FulfillmentVoucher extends Voucher {
  lines?: FulfillmentInvoiceLine[];
  fulfillmentManaged?: boolean;
  fulfillmentStatus?: "open" | "partial" | "converted";
  delivery?: PrintableDelivery & {
    associateId: string;
    profileVersion: number;
  };
  commission?: CommissionPolicy;
}
export type OrderQuantityVoucher = Pick<
  Voucher,
  "id" | "type" | "status" | "againstId"
> & {
  lines?: Pick<InvoiceLine, "qty" | "sourceLine" | "discountAmount">[];
};
export interface OrderSourceLine {
  id: string;
  sourceId: string;
  position: number;
  line: InvoiceLine;
}
export interface OrderConsumption {
  sourceLineId: string;
  targetId: string;
  targetPosition: number;
  qty: number;
}
export interface FulfillmentSelection {
  sourceLineId: string;
  qty: number;
  stockLotId?: string;
}
export interface OrderLineBalance extends OrderSourceLine {
  consumedQty: number;
  returnedQty: number;
  remainingQty: number;
  grossConsumedQty: number;
  consumedDiscount: number;
}
export interface FulfillmentBatch {
  bookScope: "gst" | "nongst";
  lines: FulfillmentInvoiceLine[];
  charges: ExtraCharge[];
}
export interface OrderFulfillmentPlan {
  source: FulfillmentVoucher;
  target: FulfillmentTarget;
  date: string;
  narration?: string;
  supplierInvoiceNo?: string;
  batches: FulfillmentBatch[];
}

const q = (n: number) => Math.round(n * 1000) / 1000;
const positiveQty = (n: number) => isStoredQuantity(n) && n > 0;

function returnedQuantity(
  vouchers: OrderQuantityVoucher[],
  id: string,
  position: number,
) {
  return q(
    vouchers
      .filter(
        (v) =>
          v.status === "posted" &&
          v.againstId === id &&
          (v.type === "credit-note" || v.type === "debit-note"),
      )
      .reduce(
        (sum, v) =>
          sum +
          (v.lines ?? []).reduce(
            (n, l, index) =>
              n + ((l.sourceLine ?? index) === position ? l.qty : 0),
            0,
          ),
        0,
      ),
  );
}

function returnedDiscount(
  vouchers: OrderQuantityVoucher[],
  id: string,
  position: number,
) {
  return vouchers
    .filter(
      (v) =>
        v.status === "posted" &&
        v.againstId === id &&
        (v.type === "credit-note" || v.type === "debit-note"),
    )
    .reduce(
      (sum, v) =>
        sum +
        (v.lines ?? []).reduce(
          (n, l, index) =>
            n +
            ((l.sourceLine ?? index) === position
              ? (l.discountAmount ?? 0)
              : 0),
          0,
        ),
      0,
    );
}

/** Returns reopen an order; a delivered-and-returned unit cannot be invoiced twice. */
export function orderLineBalances(
  source: Voucher,
  lines: OrderSourceLine[],
  consumptions: OrderConsumption[],
  vouchers: OrderQuantityVoucher[],
): OrderLineBalance[] {
  const byId = new Map(vouchers.map((v) => [v.id, v]));
  return lines
    .filter((line) => line.sourceId === source.id)
    .map((row) => {
      let gross = 0;
      let returned = 0;
      let discount = 0;
      let discountReturned = 0;
      for (const use of consumptions.filter((c) => c.sourceLineId === row.id)) {
        const target = byId.get(use.targetId);
        if (!target || target.status !== "posted") continue;
        gross = q(gross + use.qty);
        discount += target.lines?.[use.targetPosition]?.discountAmount ?? 0;
        if (target.type === "sale" || target.type === "purchase") {
          returned = q(
            returned +
              returnedQuantity(vouchers, target.id, use.targetPosition),
          );
          discountReturned += returnedDiscount(
            vouchers,
            target.id,
            use.targetPosition,
          );
        } else if (target.type === "delivery-note") {
          const delivered = lines.find(
            (l) =>
              l.sourceId === target.id && l.position === use.targetPosition,
          );
          if (delivered) {
            for (const bill of consumptions.filter(
              (c) => c.sourceLineId === delivered.id,
            )) {
              const invoice = byId.get(bill.targetId);
              if (invoice?.status === "posted") {
                returned = q(
                  returned +
                    returnedQuantity(vouchers, invoice.id, bill.targetPosition),
                );
                discountReturned += returnedDiscount(
                  vouchers,
                  invoice.id,
                  bill.targetPosition,
                );
              }
            }
          }
        }
      }
      if (returned > gross)
        throw new Error("Returned quantity exceeds fulfillment quantity.");
      const consumedQty =
        source.type === "delivery-note" ? gross : q(gross - returned);
      if (consumedQty > row.line.qty)
        throw new Error(
          "These order quantities were already fulfilled. Review the replacement entries first.",
        );
      return {
        ...row,
        consumedQty,
        returnedQty: returned,
        consumedDiscount:
          source.type === "delivery-note"
            ? discount
            : discount - discountReturned,
        grossConsumedQty: gross,
        remainingQty: q(row.line.qty - consumedQty),
      };
    });
}

export function fulfillmentStatus(
  lines: OrderLineBalance[],
): "open" | "partial" | "converted" {
  if (lines.length && lines.every((line) => line.remainingQty === 0))
    return "converted";
  return lines.some((line) => line.consumedQty > 0) ? "partial" : "open";
}

/** A later return cannot fund an earlier fulfillment, even if today's net quantity fits. */
export function assertOrderQuantityHistory(
  vouchers: Voucher[],
  lines: OrderSourceLine[],
  consumptions: OrderConsumption[],
) {
  for (const source of vouchers.filter((v) => isOrderType(v.type))) {
    const owned = new Set(
      lines
        .filter((line) => line.sourceId === source.id)
        .map((line) => line.id),
    );
    const targets = new Set(
      consumptions
        .filter((c) => owned.has(c.sourceLineId))
        .map((c) => c.targetId),
    );
    const deliveryLines = new Set(
      lines
        .filter(
          (line) =>
            targets.has(line.sourceId) &&
            vouchers.some(
              (v) => v.id === line.sourceId && v.type === "delivery-note",
            ),
        )
        .map((line) => line.id),
    );
    for (const use of consumptions.filter((c) =>
      deliveryLines.has(c.sourceLineId),
    ))
      targets.add(use.targetId);
    const related = vouchers.filter(
      (v) => targets.has(v.id) || (v.againstId && targets.has(v.againstId)),
    );
    for (const date of new Set(related.map((v) => v.date)))
      orderLineBalances(
        source,
        lines,
        consumptions,
        related.filter((v) => v.date <= date),
      );
  }
}

function ratio(amount: number, numerator: bigint, denominator: bigint) {
  return Number((BigInt(amount) * numerator + denominator / 2n) / denominator);
}
const quantityUnits = (qty: number) => BigInt(Math.round(qty * 1000));
const prorate = (amount: number, qty: number, total: number) =>
  ratio(amount, quantityUnits(qty), quantityUnits(total));

function sliceLine(
  row: OrderLineBalance,
  selection: FulfillmentSelection,
  source: Voucher,
) {
  const line: FulfillmentInvoiceLine = {
    ...structuredClone(row.line),
    qty: selection.qty,
    orderSourceLineId: row.id,
  };
  delete line.orderLineId;
  delete line.sourceLine;
  if (line.discountAmount !== undefined) {
    line.discountAmount = Math.min(
      lineGross(line),
      Math.max(
        0,
        prorate(
          calcLine(row.line, false).discount,
          q(row.consumedQty + selection.qty),
          row.line.qty,
        ) - row.consumedDiscount,
      ),
    );
  }
  if (source.type === "delivery-note") {
    if (selection.stockLotId && selection.stockLotId !== line.stockLotId)
      throw new Error("The delivery stock lot is frozen.");
    line.stockFulfilledById = source.id;
    if (!line.stockLotId || line.stockCost === undefined)
      throw new Error(
        "This delivery note has no saved stock allocation. Review the legacy delivery first.",
      );
    line.stockCost =
      prorate(
        row.line.stockCost!,
        q(row.consumedQty + selection.qty),
        row.line.qty,
      ) - prorate(row.line.stockCost!, row.consumedQty, row.line.qty);
  } else {
    delete line.stockCost;
    if (selection.stockLotId) line.stockLotId = selection.stockLotId;
  }
  return line;
}

function partialCharges(
  source: Voucher,
  balances: OrderLineBalance[],
  selections: FulfillmentSelection[],
) {
  const weights = balances.map(
    (b) => calcLine(b.line, !!source.interState).taxable,
  );
  const hasValue = weights.some((weight) => weight > 0);
  const shares = weights.map((weight, i) =>
    hasValue ? BigInt(weight) : quantityUnits(balances[i].line.qty),
  );
  const total = shares.reduce((sum, weight) => sum + weight, 0n);
  if (!total) return [];
  return (source.charges ?? [])
    .map((charge) => {
      let cumulative = 0n;
      let assigned = 0;
      const amount = balances.reduce((sum, row, i) => {
        cumulative += shares[i];
        const next = ratio(charge.amount, cumulative, total);
        const budget = next - assigned;
        assigned = next;
        const before = Math.min(row.line.qty, row.grossConsumedQty);
        const after = Math.min(
          row.line.qty,
          q(
            before +
              (selections.find((s) => s.sourceLineId === row.id)?.qty ?? 0),
          ),
        );
        return (
          sum +
          prorate(budget, after, row.line.qty) -
          prorate(budget, before, row.line.qty)
        );
      }, 0);
      return { ...charge, amount };
    })
    .filter((charge) => charge.amount > 0);
}

/** Only quantities and optional current stock lots are caller-controlled. */
export function planOrderFulfillment(input: {
  source: FulfillmentVoucher;
  balances: OrderLineBalance[];
  target: FulfillmentTarget;
  date: string;
  today: string;
  selections: FulfillmentSelection[];
  narration?: string;
  supplierInvoiceNo?: string;
  availableStockLots?: StockLot[];
}): OrderFulfillmentPlan {
  const { source, balances, target, selections } = input;
  if (!isOrderType(source.type) || !CONVERTS_TO[source.type].includes(target))
    throw new Error("This document cannot be converted to that entry type.");
  if (source.status !== "posted")
    throw new Error("Only posted orders can be fulfilled.");
  if (source.convertedToId && !source.fulfillmentManaged)
    throw new Error(
      "This legacy order is already converted. Review its linked entry first.",
    );
  if (!source.snapshot || !source.partyId)
    throw new Error("The source order needs its issued snapshot.");
  if (source.validUntil && source.validUntil < input.today)
    throw new Error(
      "This estimate has expired. Issue a current estimate first.",
    );
  if (input.date < source.date || input.date > input.today)
    throw new Error(
      "The fulfillment date must be on or after the order and no later than today.",
    );
  if (!selections.length) throw new Error("Select at least one order line.");
  const selected = new Set<string>();
  const stock = input.availableStockLots?.map((lot) => ({ ...lot }));
  const lines = selections.map((selection) => {
    if (selected.has(selection.sourceLineId))
      throw new Error("Select each source line only once.");
    selected.add(selection.sourceLineId);
    const row = balances.find(
      (b) => b.id === selection.sourceLineId && b.sourceId === source.id,
    );
    if (!row) throw new Error("This line does not belong to the order.");
    if (!positiveQty(selection.qty) || selection.qty > row.remainingQty)
      throw new Error(
        "Enter a positive quantity within the remaining order quantity, with at most 3 decimal places.",
      );
    const line = sliceLine(row, selection, source);
    if (
      (target === "sale" || target === "delivery-note") &&
      source.type !== "delivery-note" &&
      stock
    ) {
      const expectedBook =
        line.bookScope ??
        (source.taxMode === "off" || line.taxType === "nongst"
          ? "nongst"
          : "gst");
      const candidates = stock.filter(
        (lot) =>
          lot.itemId === line.itemId &&
          lot.qty > 0 &&
          lot.bookScope === expectedBook,
      );
      const lotId = selection.stockLotId ?? line.stockLotId;
      const equivalent = candidates.every(
        (lot) =>
          lot.bookScope === candidates[0]?.bookScope &&
          lot.unitCost === candidates[0]?.unitCost,
      );
      const base = q(line.qty * (line.per?.factor ?? 1));
      const lot = lotId
        ? candidates.find((l) => l.id === lotId)
        : equivalent
          ? candidates.find((l) => l.qty >= base)
          : undefined;
      if (!lot || lot.qty < base)
        throw new Error(
          "Choose an available stock lot with enough quantity for each selected line.",
        );
      if (line.bookScope && line.bookScope !== lot.bookScope)
        throw new Error(
          "The selected lot belongs to a different book from the issued order line.",
        );
      if (
        (line.taxType === "nongst" || source.taxMode === "off") &&
        lot.bookScope !== "nongst"
      )
        throw new Error("Choose non-GST stock for this order line.");
      line.stockLotId = lot.id;
      line.bookScope = lot.bookScope;
      lot.qty = q(lot.qty - base);
    }
    if (line.bookScope === "nongst") {
      line.gstRate = 0;
      line.taxType = "nongst";
    }
    return line;
  });
  const charges = partialCharges(source, balances, selections);
  checkInvoiceNumbers(lines, charges);
  const batches = (["gst", "nongst"] as const).flatMap((bookScope) => {
    const grouped = lines.filter(
      (line) =>
        (line.bookScope ??
          (source.taxMode === "off" || line.taxType === "nongst"
            ? "nongst"
            : "gst")) === bookScope,
    );
    return grouped.length
      ? [
          {
            bookScope,
            lines: grouped.map((l) => ({ ...l, bookScope })),
            charges: [] as ExtraCharge[],
          },
        ]
      : [];
  });
  // Shared invoice creation already assigns freight to one split bill. Keep that policy.
  batches[0].charges = charges.map((charge) => ({
    ...charge,
    gstRate: batches[0].bookScope === "nongst" ? 0 : charge.gstRate,
  }));
  return {
    source,
    target,
    date: input.date,
    narration: input.narration,
    supplierInvoiceNo: input.supplierInvoiceNo,
    batches,
  };
}

export const orderTargets = (type: OrderType) =>
  CONVERTS_TO[type] as FulfillmentTarget[];

/** Existing creation functions own totals, numbers, permissions-independent rules and audit. */
export function createPlannedFulfillments(
  books: Books,
  plan: OrderFulfillmentPlan,
): FulfillmentVoucher[] {
  const draft = structuredClone(books);
  const snapshot = plan.source.snapshot;
  if (!snapshot?.party)
    throw new Error("The source order needs its issued party snapshot.");
  const current = {
    firm: draft.firm,
    parties: draft.parties,
    items: draft.items,
    units: draft.units,
    invoiceSettings: draft.invoiceSettings,
  };
  draft.firm = structuredClone(snapshot.firm);
  draft.parties = draft.parties.map((party) =>
    party.id === plan.source.partyId ? structuredClone(snapshot.party!) : party,
  );
  draft.items = draft.items.map((item) => {
    const frozen = snapshot.items.find((saved) => saved.id === item.id);
    return frozen
      ? {
          ...item,
          name: frozen.name,
          hsn: frozen.hsn,
          code: frozen.code,
          taxType: frozen.taxType,
          gstRate: frozen.gstRate,
          unit: frozen.unit,
          altUnit: frozen.altUnit,
        }
      : item;
  });
  const saved: FulfillmentVoucher[] = [];
  for (const batch of plan.batches) {
    // Already delivered stock is released only inside this validation draft. The
    // persisted delivery continues to move it, and the new bill carries its provenance.
    const hidden = draft.vouchers.filter(
      (v) =>
        (plan.source.type === "delivery-note" && v.id === plan.source.id) ||
        (plan.target === "purchase" &&
          saved.some((child) => child.id === v.id)),
    );
    draft.vouchers = draft.vouchers.filter((v) => !hidden.includes(v));
    const input = {
      partyId: plan.source.partyId!,
      date: plan.date,
      lines: batch.lines,
      charges: batch.charges,
      bookScope: batch.bookScope,
      supplierInvoiceNo: plan.supplierInvoiceNo,
      narration: plan.narration,
    };
    const voucher: FulfillmentVoucher =
      plan.target === "sale"
        ? createSale(draft, input)
        : plan.target === "purchase"
          ? createPurchase(draft, input)
          : createOrder(draft, plan.target, input);
    draft.vouchers.push(...hidden);
    voucher.sourceId = plan.source.id;
    voucher.fulfillmentManaged = true;
    voucher.bookScope = batch.bookScope;
    voucher.snapshot = structuredClone(snapshot);
    voucher.delivery = plan.source.delivery
      ? structuredClone(plan.source.delivery)
      : undefined;
    voucher.commission = plan.source.commission
      ? structuredClone(plan.source.commission)
      : undefined;
    voucher.interState = plan.source.interState;
    voucher.taxMode = plan.source.taxMode;
    voucher.lines = voucher.lines?.map((line, position) => ({
      ...line,
      orderSourceLineId: batch.lines[position].orderSourceLineId,
      stockFulfilledById: batch.lines[position].stockFulfilledById,
      ...(batch.lines[position].stockFulfilledById
        ? {
            stockLotId: batch.lines[position].stockLotId,
            stockCost: batch.lines[position].stockCost,
          }
        : {}),
    }));
    saved.push(voucher);
  }
  Object.assign(draft, current);
  Object.assign(books, draft);
  return saved;
}
