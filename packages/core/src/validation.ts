/**
 * Form checks shared by the apps (and later the API).
 * Each function returns the first problem as a sentence the user can act on, or null if all is well.
 */
import type { Bill } from "./accounting/bills";
import { formatINR } from "./money";
import { stateFromGstin } from "./states";
import type {
  GstMode,
  InvoiceLine,
  Item,
  ItemInput,
  NewFirmInput,
  Paise,
  Party,
  PartyInput,
} from "./types";

/** Sale or purchase invoice. */
export function checkInvoice(input: {
  kind: "sale" | "purchase";
  partyId?: string;
  lines: InvoiceLine[];
  grandTotal: Paise;
  /** Money received/paid now. */
  paidNow?: Paise;
}): string | null {
  const who = input.kind === "sale" ? "customer" : "supplier";
  if (!input.partyId) return `Pick a ${who}.`;
  if (input.lines.length === 0) return "Add at least one item.";
  for (const [i, line] of input.lines.entries()) {
    if (!(line.qty > 0)) return `Item ${i + 1}: quantity must be more than 0.`;
    if (!(line.rate > 0)) return `Item ${i + 1}: enter a rate.`;
    if (
      line.discountPercent !== undefined &&
      (line.discountPercent < 0 || line.discountPercent > 100)
    )
      return `Item ${i + 1}: discount must be between 0 and 100%.`;
  }
  if ((input.paidNow ?? 0) > input.grandTotal)
    return `Amount ${input.kind === "sale" ? "received" : "paid"} can't be more than the invoice total of ${formatINR(input.grandTotal)}.`;
  return null;
}

/** Receipt (money in) or payment (money out), with bill-wise allocation. */
export function checkMoney(input: {
  kind: "receipt" | "payment";
  partyId?: string;
  /** Bill value being settled (for receipts this is the amount received). */
  amount: Paise | null;
  allocations: { bill: Bill; amount: Paise }[];
}): string | null {
  const who = input.kind === "receipt" ? "customer" : "supplier";
  if (!input.partyId) return `Pick a ${who}.`;
  if (!input.amount || input.amount <= 0)
    return input.kind === "receipt"
      ? "Enter the amount received."
      : "Enter the amount to pay.";
  const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
  for (const a of input.allocations) {
    if (a.amount > a.bill.pending)
      return `${a.bill.number}: only ${formatINR(a.bill.pending)} is pending.`;
  }
  if (allocated > input.amount)
    return `Bills add up to ${formatINR(allocated)} but the amount is ${formatINR(input.amount)}. Lower the bill amounts.`;
  return null;
}

export function checkExpense(input: {
  expenseHead: string;
  amount: Paise | null;
}): string | null {
  if (!input.expenseHead.trim()) return "Pick what the money was spent on.";
  if (!input.amount || input.amount <= 0) return "Enter the amount spent.";
  return null;
}

/** Journal entry: at least two lines, one side per line, debits equal credits. */
export function checkJournal(
  lines: { account: string; debit: Paise; credit: Paise }[],
): string | null {
  const used = lines.filter((l) => l.account || l.debit || l.credit);
  if (used.length < 2) return "Add at least two lines.";
  for (const [i, l] of used.entries()) {
    if (!l.account) return `Line ${i + 1}: pick an account.`;
    if (l.debit && l.credit)
      return `Line ${i + 1}: use either Dr or Cr, not both.`;
    if (!l.debit && !l.credit) return `Line ${i + 1}: enter an amount.`;
  }
  const debit = used.reduce((s, l) => s + l.debit, 0);
  const credit = used.reduce((s, l) => s + l.credit, 0);
  if (debit > credit)
    return `Debits exceed credits by ${formatINR(debit - credit)}.`;
  if (credit > debit)
    return `Credits exceed debits by ${formatINR(credit - debit)}.`;
  return null;
}

/** GSTIN: 2-digit state + 10-char PAN + entity digit + "Z" + check character. */
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;

/** Firm profile form. Returns an error per field; an empty object means OK. */
export function checkFirm(
  f: { name: string; gstin: string; pan: string; phone: string; email: string },
  stateCode: string,
): Partial<Record<"name" | "gstin" | "pan" | "phone" | "email", string>> {
  const errors: Partial<
    Record<"name" | "gstin" | "pan" | "phone" | "email", string>
  > = {};
  if (!f.name.trim()) errors.name = "Enter the firm name.";
  if (f.gstin && !GSTIN_PATTERN.test(f.gstin))
    errors.gstin = "GSTIN should be 15 characters, like 09AAAAA0000A1Z5.";
  else if (f.gstin && f.gstin.slice(0, 2) !== stateCode)
    errors.gstin = `GSTIN should start with your state code ${stateCode}.`;
  if (f.pan && !PAN_PATTERN.test(f.pan))
    errors.pan = "PAN should be 10 characters, like AAAAA0000A.";
  else if (
    f.pan &&
    f.gstin &&
    GSTIN_PATTERN.test(f.gstin) &&
    f.gstin.slice(2, 12) !== f.pan
  )
    errors.pan = "PAN doesn't match the GSTIN.";
  if (f.phone && !/^\d{10}$/.test(f.phone.replace(/\s/g, "")))
    errors.phone = "Enter a 10-digit mobile number.";
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
    errors.email = "Enter a valid email.";
  return errors;
}

// ---------------------------------------------------------------------------
// Party and item masters
// ---------------------------------------------------------------------------

export type PartyErrors = Partial<
  Record<
    "name" | "phone" | "gstin" | "stateCode" | "creditDays" | "creditLimit",
    string
  >
>;

/** Party form. `editingId` skips the party itself in the duplicate checks. */
export function checkParty(
  p: PartyInput,
  others: Party[],
  editingId?: string,
): PartyErrors {
  const e: PartyErrors = {};
  const rest = others.filter((o) => o.id !== editingId);
  const name = p.name.trim().toLowerCase();
  if (!name) e.name = "Enter the party name.";
  else if (rest.some((o) => o.name.trim().toLowerCase() === name))
    e.name = "A party with this name already exists.";
  const digits = p.phone.replace(/\D/g, "");
  if (p.phone && digits.length !== 10)
    e.phone = "Enter a 10-digit mobile number.";
  if (p.gstin) {
    if (!GSTIN_PATTERN.test(p.gstin))
      e.gstin = "GSTIN should be 15 characters, like 09AAGFA7788Q1Z1.";
    else if (!stateFromGstin(p.gstin))
      e.gstin = "The first two digits aren't a valid state code.";
    else if (p.gstin.slice(0, 2) !== p.stateCode)
      e.gstin = "GSTIN doesn't match the state.";
    else if (rest.some((o) => o.gstin === p.gstin && o.type === p.type))
      e.gstin = "Another party already has this GSTIN.";
  }
  if (!p.stateCode)
    e.stateCode = "Pick the state (needed for CGST/SGST or IGST).";
  if (!Number.isInteger(p.creditDays) || p.creditDays < 0 || p.creditDays > 365)
    e.creditDays = "Credit days should be 0 to 365.";
  if (p.creditLimit < 0) e.creditLimit = "Credit limit can't be negative.";
  return e;
}

export type ItemErrors = Partial<
  Record<
    | "gstRate"
    | "name"
    | "code"
    | "hsn"
    | "unit"
    | "altUnit"
    | "salePrice"
    | "purchasePrice"
    | "mrp"
    | "reorderLevel"
    | "openingStock",
    string
  >
>;

/** Item form. Returns blocking errors; see `itemWarnings` for things worth a second look. */
export function checkItem(
  i: ItemInput,
  others: Item[],
  editingId?: string,
  /** The firm's GST mode: without GST, rates and HSN aren't asked for. */
  mode: GstMode = "regular",
): ItemErrors {
  const e: ItemErrors = {};
  const rest = others.filter((o) => o.id !== editingId);
  if (!i.name.trim()) e.name = "Enter the item name.";
  else if (
    rest.some(
      (o) => o.name.trim().toLowerCase() === i.name.trim().toLowerCase(),
    )
  )
    e.name = "An item with this name already exists.";
  if (i.code && rest.some((o) => o.code.toLowerCase() === i.code.toLowerCase()))
    e.code = "This code is already used.";
  // HSN is needed on regular GST bills; non-GST goods (petrol, liquor …),
  // composition firms and firms without GST may leave it empty
  const hsnRequired = mode === "regular" && i.taxType !== "nongst";
  if (hsnRequired && !i.hsn.trim())
    e.hsn = "Enter the HSN code (4, 6 or 8 digits).";
  else if (i.hsn.trim() && !/^\d{4}(\d{2}(\d{2})?)?$/.test(i.hsn.trim()))
    e.hsn = "HSN/SAC should be 4, 6 or 8 digits.";
  if (!i.unit.trim()) e.unit = "Pick a unit.";
  if (mode !== "off" && i.taxType === "taxable" && i.gstRate === 0)
    e.gstRate = "Pick a GST rate, or choose Nil-rated / Exempt.";
  if (mode !== "off" && i.taxType !== "taxable" && i.gstRate !== 0)
    e.gstRate = "Only taxable items have a GST rate.";
  if (i.altUnit) {
    if (!i.altUnit.name.trim()) e.altUnit = "Name the second unit, e.g. Box.";
    else if (!Number.isInteger(i.altUnit.factor) || i.altUnit.factor < 2)
      e.altUnit = `How many ${i.unit} in one ${i.altUnit.name}? (2 or more)`;
    else if (i.altUnit.name.trim().toLowerCase() === i.unit.toLowerCase())
      e.altUnit = "The second unit must be different.";
  }
  if (i.salePrice <= 0) e.salePrice = "Enter the sale price.";
  if (i.purchasePrice < 0)
    e.purchasePrice = "Purchase price can't be negative.";
  if (i.mrp < 0) e.mrp = "MRP can't be negative.";
  else if (i.mrp > 0 && i.salePrice > i.mrp)
    e.mrp = "Sale price can't be more than MRP.";
  if (i.reorderLevel < 0) e.reorderLevel = "Can't be negative.";
  if (i.openingStock < 0) e.openingStock = "Can't be negative.";
  return e;
}

/** Non-blocking hints shown under the item form. */
export function itemWarnings(i: ItemInput): string[] {
  const w: string[] = [];
  if (i.purchasePrice > 0 && i.salePrice > 0 && i.salePrice < i.purchasePrice)
    w.push("Sale price is below purchase price — you'll sell at a loss.");
  if (i.purchasePrice === 0)
    w.push(
      "Without a purchase price, stock value and profit will show as zero.",
    );
  return w;
}

/** Margin on sale price, e.g. bought 165, sells 195 → 15.4. Null when it can't be worked out. */
export function marginPercent(
  purchasePrice: Paise,
  salePrice: Paise,
): number | null {
  if (!salePrice || !purchasePrice) return null;
  return Math.round(((salePrice - purchasePrice) / salePrice) * 1000) / 10;
}

/** Short item code from a name: "Fortune Mustard Oil 1 L" → "FMO1L", made unique against existing codes. */
export function suggestItemCode(name: string, items: Item[]): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  const base =
    words
      .map((w) => (/^\d/.test(w) ? w : w[0]))
      .join("")
      .slice(0, 8) || "ITEM";
  const used = new Set(items.map((i) => i.code.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// Dates and contra
// ---------------------------------------------------------------------------

/**
 * Voucher date: not in the future, and not before the start of the financial year
 * (earlier years are closed in this app).
 */
export function checkVoucherDate(
  date: string,
  todayIso: string,
  fyStart: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick a date.";
  if (date > todayIso) return "The date can't be in the future.";
  if (date < fyStart) return "The date is before this financial year.";
  return null;
}

export function checkContra(input: {
  fromLedgerId: string;
  toLedgerId: string;
  amount: number;
}): string | null {
  if (!input.fromLedgerId || !input.toLedgerId) return "Pick both accounts.";
  if (input.fromLedgerId === input.toLedgerId)
    return "Pick two different accounts.";
  if (!(input.amount > 0)) return "Enter the amount.";
  return null;
}

/** Adding another firm: name, city, state, and a GSTIN that matches the state when registered. */
export function checkNewFirm(
  f: NewFirmInput,
): Partial<Record<"name" | "city" | "gstin", string>> {
  const errors: Partial<Record<"name" | "city" | "gstin", string>> = {};
  if (!f.name.trim()) errors.name = "Enter the firm name.";
  if (!f.city.trim()) errors.city = "Enter the city.";
  const gstin = (f.gstin ?? "").trim().toUpperCase();
  if (f.gstRegistration === "unregistered") {
    if (gstin)
      errors.gstin = "Leave GSTIN empty for a firm not registered under GST.";
  } else if (!gstin)
    errors.gstin = "Enter the GSTIN, or choose Not registered.";
  else if (!GSTIN_PATTERN.test(gstin))
    errors.gstin = "GSTIN should be 15 characters, like 09AAAAA0000A1Z5.";
  else if (gstin.slice(0, 2) !== f.stateCode)
    errors.gstin = `GSTIN should start with the state code ${f.stateCode}.`;
  return errors;
}
