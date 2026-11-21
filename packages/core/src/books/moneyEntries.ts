/** Receipts, payments, expenses, journals and contra entries. */
import { claimsInputTax, gstModeOf } from "../accounting/gstMode";
import { calcInvoice } from "../accounting/invoice";
import { checkInvoiceNumbers } from "../accounting/invoiceValidation";
import { allocateAvailablePayments } from "../accounting/paymentAllocation";
import { UNREGISTERED_SUPPLIER_GST_MESSAGE } from "../accounting/taxType";
import { captureVoucherSnapshot } from "../accounting/voucherSnapshot";
import type {
  InventoryAdjustment,
  ISODate,
  NewContraInput,
  NewExpenseInput,
  NewJournalInput,
  NewMoneyInput,
  Voucher,
} from "../types";
import { checkContra } from "../validation";
import type { CreateOptions, Db } from "./base";
import { findParty, logAudit, newId, takeNumber } from "./base";
// ---------------------------------------------------------------------------
// Receipts (money in) and payments (money out)
// ---------------------------------------------------------------------------

export function createReceipt(
  db: Db,
  input: NewMoneyInput,
  options: CreateOptions = {},
): Voucher {
  return createMoneyVoucher(
    db,
    "receipt",
    { ...input, tds: undefined },
    options,
  );
}

export function createPayment(
  db: Db,
  input: NewMoneyInput,
  options: CreateOptions = {},
): Voucher {
  return createMoneyVoucher(db, "payment", input, options);
}

function createMoneyVoucher(
  db: Db,
  type: "receipt" | "payment",
  input: NewMoneyInput,
  options: CreateOptions,
): Voucher {
  findParty(db, input.partyId);
  const settles = input.amount + (input.tds?.amount ?? 0);
  const allocated = input.allocations.reduce((s, a) => s + a.amount, 0);
  if (allocated > settles)
    throw new Error("Bills settled are more than the amount");
  const voucher: Voucher = {
    id: newId("v"),
    type,
    number: takeNumber(db, type, input.date),
    bookScope:
      input.bookScope ?? (gstModeOf(db.firm) === "off" ? "nongst" : "gst"),
    date: input.date,
    status: options.status ?? "posted",
    partyId: input.partyId,
    snapshot: captureVoucherSnapshot(db, input.partyId),
    mode: input.mode,
    ledgerId: input.ledgerId,
    reference: input.reference,
    allocations: input.allocations.filter((a) => a.amount > 0),
    tds: input.tds && input.tds.amount > 0 ? input.tds : undefined,
    amount: input.amount,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  db.vouchers.push(voucher);
  logAudit(db, "created", voucher);
  return voucher;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function createExpense(
  db: Db,
  input: NewExpenseInput,
  options: CreateOptions = {},
): Voucher {
  const mode = gstModeOf(db.firm);
  // GST on an expense is a taxed charge, so GST reports and postings treat it like a purchase charge.
  const gst = input.gst?.rate ? input.gst : undefined;
  let taxed: Pick<Voucher, "partyId" | "charges" | "interState" | "taxMode"> =
    {};
  let amount = input.amount;
  if (gst) {
    if (!claimsInputTax(mode))
      throw new Error("Only a regular GST firm can claim GST on expenses.");
    const party = findParty(db, gst.partyId);
    if (party.type !== "supplier") throw new Error("Pick a supplier.");
    if (!party.gstin?.trim())
      throw new Error(UNREGISTERED_SUPPLIER_GST_MESSAGE);
    const interState = party.stateCode !== db.firm.stateCode;
    const charges = [
      { name: input.expenseHead, amount: gst.taxable, gstRate: gst.rate },
    ];
    checkInvoiceNumbers([], charges);
    amount = calcInvoice({ lines: [], charges, interState }).totalBeforeRound;
    taxed = { partyId: party.id, charges, interState, taxMode: mode };
  }
  const voucher: Voucher = {
    id: newId("v"),
    type: "expense",
    bookScope: gst
      ? "gst"
      : (input.bookScope ?? (mode === "off" ? "nongst" : "gst")),
    number: takeNumber(db, "expense", input.date),
    date: input.date,
    status: options.status ?? "posted",
    expenseHead: input.expenseHead,
    snapshot: captureVoucherSnapshot(db, taxed.partyId),
    ledgerId: input.ledgerId,
    mode: input.mode,
    ...taxed,
    amount,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  db.vouchers.push(voucher);
  logAudit(db, "created", voucher);
  return voucher;
}

// ---------------------------------------------------------------------------
// Journals
// ---------------------------------------------------------------------------

export function createJournal(
  db: Db,
  input: NewJournalInput,
  options: CreateOptions = {},
): Voucher {
  const lines = input.lines.filter((l) => l.debit > 0 || l.credit > 0);
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  if (lines.length < 2 || debit !== credit)
    throw new Error("Debits must equal credits");
  return recordJournal(db, { ...input, lines }, debit, options);
}

/** Quantity-only stock corrections carry an audit voucher but no financial postings. */
export function createInventoryJournal(
  db: Db,
  input: NewJournalInput,
  movement: InventoryAdjustment,
): Voucher {
  const quantityOnly = movement.value === 0 && movement.quantity !== 0;
  if (quantityOnly && input.lines.length !== 0)
    throw new Error(
      "A quantity-only correction cannot contain financial lines.",
    );
  const voucher = quantityOnly
    ? recordJournal(db, input, 0, {})
    : createJournal(db, input);
  voucher.inventoryAdjustment = movement;
  return voucher;
}

function recordJournal(
  db: Db,
  input: NewJournalInput,
  amount: number,
  options: CreateOptions,
): Voucher {
  const voucher: Voucher = {
    id: newId("v"),
    type: "journal",
    bookScope:
      input.bookScope ?? (gstModeOf(db.firm) === "off" ? "nongst" : "gst"),
    number: takeNumber(db, "journal", input.date),
    date: input.date,
    status: options.status ?? "posted",
    journalLines: input.lines,
    snapshot: captureVoucherSnapshot(db, undefined),
    amount,
    narration: input.narration,
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  db.vouchers.push(voucher);
  logAudit(db, "created", voucher);
  return voucher;
}

/** Assign unused receipts/payments oldest first, preserving amounts and existing allocations. */
export function allocatePartyPayments(db: Db, partyId: string, asOf: ISODate) {
  const party = findParty(db, partyId);
  const { allocated, changes } = allocateAvailablePayments(db, party, asOf);
  for (const { voucher, before, allocated: added } of changes) {
    voucher.editedAt = new Date().toISOString();
    logAudit(
      db,
      "edited",
      voucher,
      [
        {
          field: "Bill allocation",
          before: String(before),
          after: String(before + added),
        },
      ],
      "Allocated on-account payment to oldest open bills",
    );
  }
  return { allocated };
}

// ---------------------------------------------------------------------------
// Contra: money between cash and bank
// ---------------------------------------------------------------------------

export function createContra(
  db: Db,
  input: NewContraInput,
  options: CreateOptions = {},
): Voucher {
  const problem = checkContra(input);
  if (problem) throw new Error(problem);
  const from = db.ledgers.find((l) => l.id === input.fromLedgerId);
  const to = db.ledgers.find((l) => l.id === input.toLedgerId);
  if (!from || !to) throw new Error("Account not found");
  const voucher: Voucher = {
    id: newId("v"),
    type: "contra",
    bookScope:
      input.bookScope ?? (gstModeOf(db.firm) === "off" ? "nongst" : "gst"),
    number: takeNumber(db, "contra", input.date),
    date: input.date,
    status: options.status ?? "posted",
    ledgerId: from.id,
    toLedgerId: to.id,
    reference: input.reference,
    amount: input.amount,
    // Shown in the cash book / bank book as the "particulars"
    narration:
      input.narration ||
      (from.kind === "cash"
        ? `Cash deposited in ${to.name}`
        : to.kind === "cash"
          ? `Cash withdrawn from ${from.name}`
          : `${from.name} → ${to.name}`),
    pendingSync: options.pendingSync,
    createdAt: new Date().toISOString(),
  };
  db.vouchers.push(voucher);
  logAudit(db, "created", voucher);
  return voucher;
}
