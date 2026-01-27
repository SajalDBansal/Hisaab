import { hasStoredPrecision, isStoredQuantity } from "../precision";
import type { ExtraCharge, InvoiceLine } from "../types";
import { calcInvoice } from "./invoice";

/** Entered and converted quantities must survive database storage unchanged. */
function checkQuantities(line: InvoiceLine): void {
  const factor = line.per?.factor ?? 1;
  const baseQty = Math.round(line.qty * factor * 1000) / 1000;
  if (
    !isStoredQuantity(line.qty) ||
    line.qty <= 0 ||
    !isStoredQuantity(factor) ||
    factor <= 0
  )
    throw new Error(
      "Quantity and unit factor must be positive with at most 3 decimal places.",
    );
  // The quantity moved into stock must also fit the same database column.
  if (
    !isStoredQuantity(baseQty) ||
    Math.abs(baseQty - line.qty * factor) > 1e-9
  )
    throw new Error("The base quantity must fit within 3 decimal places.");
}

function checkLineMoney(line: InvoiceLine): void {
  const discount = line.discountPercent ?? 0;
  if (!hasStoredPrecision(discount) || discount < 0 || discount > 100)
    throw new Error(
      "Discount must be between 0 and 100 with at most 3 decimal places.",
    );
  if (
    !Number.isSafeInteger(line.rate) ||
    line.rate <= 0 ||
    !Number.isSafeInteger(line.discountAmount ?? 0) ||
    (line.discountAmount ?? 0) < 0 ||
    !Number.isSafeInteger(Math.round(line.qty * line.rate))
  )
    throw new Error("The line amount is outside the supported range.");
}

/** Reject values that would change when saved or exceed safe integer money arithmetic. */
export function checkInvoiceNumbers(
  lines: InvoiceLine[],
  charges: ExtraCharge[] = [],
): void {
  for (const line of lines) {
    checkQuantities(line);
    checkLineMoney(line);
  }
  if (
    charges.some(
      (charge) => !Number.isSafeInteger(charge.amount) || charge.amount < 0,
    )
  )
    throw new Error("The charge amount is outside the supported range.");
  for (const interState of [false, true]) {
    const totals = calcInvoice({ lines, charges, interState });
    if (
      !Number.isSafeInteger(totals.totalBeforeRound) ||
      !Number.isSafeInteger(totals.grandTotal)
    )
      throw new Error("The invoice amount is outside the supported range.");
  }
}
