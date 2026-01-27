import { financialYear } from "../dates";
import type { NewInvoiceInput, Voucher } from "../types";

const normalized = (value?: string) =>
  value?.trim().replace(/\s+/g, "").toUpperCase();

// A supplier can reuse a number in another financial year, but not on two active bills.
export function checkSupplierInvoice(
  vouchers: Voucher[],
  input: NewInvoiceInput,
  exceptId?: string,
) {
  const number = normalized(input.supplierInvoiceNo);
  if (!number) return;
  const year = financialYear(input.date).start;
  const duplicate = vouchers.find(
    (v) =>
      v.id !== exceptId &&
      v.type === "purchase" &&
      v.status === "posted" &&
      v.partyId === input.partyId &&
      normalized(v.supplierInvoiceNo) === number &&
      financialYear(v.date).start === year,
  );
  if (duplicate)
    throw new Error(
      `Supplier invoice ${input.supplierInvoiceNo?.trim()} is already recorded as ${duplicate.number}.`,
    );
}
