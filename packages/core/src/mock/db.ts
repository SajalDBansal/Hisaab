/**
 * In-memory mock database.
 *
 * Holds all data while the app runs and contains the "write" logic
 * (create sale, create receipt …). The real backend will do the same work
 * on the server; until then the services in `src/services` call these functions.
 * Data resets when the app reloads.
 */
import type { OpeningAccount } from "../accounting/generalLedger";
import type { CustomAccount } from "../accounting/accounts";
import { billAllocations } from "../accounting/settlements";
import { allocateAvailablePayments } from "../accounting/paymentAllocation";
import { purchaseReturnLines } from "../accounting/purchaseReturnCost";
import { returnAllocations } from "../accounting/returnAllocations";
import { calcInvoice } from "../accounting/invoice";
import { returnAmountBasis, returnAmounts } from "../accounting/returnAmounts";
import { returnStockCost } from "../accounting/returnStockCost";
import {
  assertLotsAvailable,
  purchaseLineCost,
  purchaseLotId,
  selectStockLines,
  stockLots,
} from "../accounting/stockLots";
import { baseQty } from "../accounting/stock";
import { bankClearedOn } from "../accounting/reconcile";
import { ledgerEffect } from "../accounting/reports";
import { bookScopeOf } from "../accounting/bookScope";
import { checkInvoiceNumbers } from "../accounting/invoiceValidation";
import { checkSupplierInvoice } from "../accounting/supplierInvoices";
import { isStoredQuantity } from "../precision";
import {
  captureVoucherSnapshot,
  editedVoucherSnapshot,
} from "../accounting/voucherSnapshot";
import { formatINR } from "../money";
import {
  itemTaxType,
  mixesNonGst,
  NON_GST_MIX_MESSAGE,
  UNREGISTERED_SUPPLIER_GST_MESSAGE,
} from "../accounting/taxType";
import { CONVERTS_TO, isOrderType } from "../accounting/orders";
import {
  applyGstMode,
  claimsInputTax,
  gstModeOf,
  modeBlocker,
  saleDocFor,
  sideOf,
  voucherMode,
} from "../accounting/gstMode";
import { voucherChanges } from "../accounting/audit";
import { checkUnit } from "../units";
import {
  checkContra,
  checkItem,
  checkNewFirm,
  checkParty,
} from "../validation";
import { addDays, financialYear, formatDate } from "../dates";
import type {
  AuditAction,
  AuditChange,
  AuditEntry,
  GstMode,
  Firm,
  FirmUpdate,
  ID,
  InvoiceLine,
  InvoiceSettings,
  InventoryAdjustment,
  ItemInput,
  PartyInput,
  ReminderSettings,
  NewDocumentInput,
  StoredDocument,
  TeamMember,
  UnitDef,
  ISODate,
  Item,
  Ledger,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewContraInput,
  NewOrderInput,
  OrderType,
  NewNoteInput,
  NewMoneyInput,
  Party,
  Voucher,
  VoucherType,
} from "../types";

export interface Db {
  accounts?: CustomAccount[];
  firm: Firm;
  parties: Party[];
  items: Item[];
  ledgers: Ledger[];
  vouchers: Voucher[];
  /** Opening balances of other accounts, e.g. furniture. Capital balances them. */
  openingAccounts: OpeningAccount[];
  /** Last used number per voucher type and financial year, e.g. { "sale:26-27": 149 }. */
  counters: Record<string, number>;
  invoiceSettings: InvoiceSettings;
  team: TeamMember[];
  /** The person using the app (an owner in the demo). */
  currentUserId: ID;
  documents: StoredDocument[];
  /** Units of measure the firm can use on items. */
  units: UnitDef[];
  /** WhatsApp payment reminder rules. */
  reminders: ReminderSettings;
  /** Last date a reminder was sent to each customer (partyId → date). */
  remindedOn: Record<ID, ISODate>;
  /** Notifications the user has already seen. */
  readNotices: string[];
  /** When the books were last backed up (ISO date-time). */
  lastBackupAt?: string;
  /** Edit history of every voucher: only ever added to (see accounting/audit.ts). */
  auditLog: AuditEntry[];
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  daysBefore: 3,
  onDueDate: true,
  repeatEvery: 7,
  minAmount: 50000, // ₹500
};

/** Default voucher number prefixes; the owner can change them in Settings. */
export const DEFAULT_BILL_OF_SUPPLY_PREFIX = "BS";

export const DEFAULT_PREFIXES: Record<VoucherType, string> = {
  sale: "SI",
  purchase: "PI",
  receipt: "RC",
  payment: "PY",
  expense: "EX",
  journal: "JV",
  "credit-note": "CN",
  "debit-note": "DN",
  contra: "CT",
  estimate: "EST",
  "sales-order": "SO",
  "delivery-note": "DC",
  "purchase-order": "PO",
};

let idCounter = 0;
export function newId(prefix: string): ID {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Number the next voucher would get, e.g. "SI/26-27/0150". Does not reserve it. */
/** Number series: normal, or "bos" for sales bills of supply (their own series, e.g. BS/26-27/0001). */
export type Series = "bos" | "nongst";

const counterKey = (type: VoucherType, date: ISODate, series?: Series) =>
  `${type}${series ? `-${series}` : ""}:${financialYear(date).short}`;

export function peekNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const fy = financialYear(date).short;
  const next = (db.counters[counterKey(type, date, series)] ?? 0) + 1;
  const prefix =
    series === "nongst"
      ? `N${db.invoiceSettings.prefixes[type]}`
      : series === "bos"
        ? db.invoiceSettings.billOfSupplyPrefix
        : db.invoiceSettings.prefixes[type];
  return `${prefix}/${fy}/${String(next).padStart(4, "0")}`;
}

function takeNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const number = peekNumber(db, type, date, series);
  const key = counterKey(type, date, series);
  db.counters[key] = (db.counters[key] ?? 0) + 1;
  return number;
}

export function findParty(db: Db, id: ID): Party {
  const party = db.parties.find((p) => p.id === id);
  if (!party) throw new Error(`Party not found: ${id}`);
  return party;
}

interface CreateOptions {
  /** Only the historical demo importer uses this; API inputs cannot enable it. */
  legacyStock?: boolean;
  pendingSync?: boolean;
  status?: Voucher["status"];
}

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
  );
  const scopes = (["gst", "nongst"] as const).filter((scope) =>
    selected.some((l) => l.bookScope === scope),
  );
  if (scopes.length > 1 && input.sourceId)
    throw new Error(
      "Split this mixed order into separate orders before conversion.",
    );
  let remaining = input.paidNow?.amount ?? 0;
  const saved = scopes.map((bookScope, index) => {
    const voucher = createInvoice(
      draft,
      "sale",
      {
        ...input,
        bookScope,
        lines: selected.filter((l) => l.bookScope === bookScope),
        charges: index === 0 ? input.charges : [],
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

/** A converted challan releases its stock to the replacement invoice. */
function stockForInvoice(db: Db, input: NewInvoiceInput, excludeId?: string) {
  return db.vouchers.filter(
    (v) =>
      v.id !== excludeId &&
      !(v.id === input.sourceId && v.type === "delivery-note"),
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
function billParts(
  db: Db,
  type: VoucherType,
  mode: GstMode,
  input: Pick<NewInvoiceInput, "lines" | "charges" | "bookScope">,
  previousLines: InvoiceLine[] = [],
) {
  const side = sideOf(type) ?? "sale";
  const lines: InvoiceLine[] = applyGstMode(
    input.lines.map((line) => savedLineDetails(db, line, previousLines)),
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
    ? applyGstMode(input.charges, mode, side).map((c) =>
        input.bookScope === "nongst" ? { ...c, gstRate: 0 as const } : c,
      )
    : undefined;
  checkInvoiceNumbers(lines, charges);
  return { side, lines, charges };
}

/** Legacy bills already saved their tax and pack factor, even before master snapshots existed. */
function savedLineDetails(
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

// ---------------------------------------------------------------------------
// Edit history (audit trail)
// ---------------------------------------------------------------------------

/** Add one line to the edit log. There is no way to remove or switch it off. */
export function logAudit(
  db: Db,
  action: AuditAction,
  v: Voucher,
  changes: AuditChange[] = [],
  note?: string,
): void {
  const user = db.team.find((m) => m.id === db.currentUserId);
  db.auditLog.push({
    id: newId("log"),
    voucherId: v.id,
    number: v.number,
    voucherType: v.type,
    action,
    // "created" uses the voucher's own save time (seed data is dated in the past)
    at: action === "created" ? v.createdAt : new Date().toISOString(),
    userId: db.currentUserId,
    userName: user?.name ?? "Unknown",
    changes,
    note,
  });
}

const auditNames = (db: Db) => ({
  party: (id?: string) => db.parties.find((p) => p.id === id)?.name ?? "",
  item: (id: string) => db.items.find((i) => i.id === id)?.name ?? "Item",
});

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
  const { side, charges } = parts;
  const lines = parts.lines.map((l) =>
    type === "purchase"
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
  const invoice: Voucher = {
    id: newId("v"),
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
// Settings, team and documents
// ---------------------------------------------------------------------------

export function updateFirm(db: Db, patch: FirmUpdate): Firm {
  if (patch.name !== undefined && !patch.name.trim())
    throw new Error("Firm name can't be empty.");
  const next = { ...db.firm, ...patch };
  // GST setting: a GSTIN is needed for regular and composition, and none without GST.
  // New bills follow the new setting; bills already saved keep theirs.
  if (patch.gstRegistration !== undefined || patch.gstin !== undefined) {
    if (next.gstRegistration === "unregistered") next.gstin = "";
    const problem = checkNewFirm({
      name: next.name,
      city: next.city,
      stateCode: next.stateCode,
      gstin: next.gstin,
      gstRegistration: next.gstRegistration,
    }).gstin;
    if (problem) throw new Error(problem);
  }
  if (next.gstRegistration === "composition") next.compositionType ??= "trader";
  else delete next.compositionType;
  db.firm = next;
  return db.firm;
}

export function updateInvoiceSettings(
  db: Db,
  patch: Partial<InvoiceSettings>,
): InvoiceSettings {
  if (patch.prefixes) {
    for (const [type, prefix] of Object.entries(patch.prefixes)) {
      if (!/^[A-Z0-9-]{1,5}$/.test(prefix))
        throw new Error(
          `Prefix for ${type} must be 1–5 capital letters or digits.`,
        );
    }
  }
  if (
    patch.billOfSupplyPrefix !== undefined &&
    !/^[A-Z0-9-]{1,5}$/.test(patch.billOfSupplyPrefix)
  ) {
    throw new Error(
      "Bill of supply prefix must be 1–5 capital letters or digits.",
    );
  }
  const next = {
    ...db.invoiceSettings,
    ...patch,
    prefixes: { ...db.invoiceSettings.prefixes, ...patch.prefixes },
  };
  const salePrefix = next.prefixes.sale;
  if (
    next.billOfSupplyPrefix === salePrefix ||
    next.billOfSupplyPrefix === `N${salePrefix}`
  )
    throw new Error(
      "Tax invoice, non-GST invoice and bill of supply prefixes must be different.",
    );
  db.invoiceSettings = next;
  return db.invoiceSettings;
}

export function updateMember(
  db: Db,
  id: ID,
  patch: Partial<Pick<TeamMember, "role" | "active">>,
): TeamMember {
  const member = db.team.find((m) => m.id === id);
  if (!member) throw new Error("Team member not found");
  const owners = db.team.filter((m) => m.role === "owner" && m.active);
  if (
    member.role === "owner" &&
    owners.length === 1 &&
    ((patch.role && patch.role !== "owner") || patch.active === false)
  ) {
    throw new Error("Keep at least one owner.");
  }
  Object.assign(member, patch);
  return member;
}

export function inviteMember(
  db: Db,
  input: { email: string; role: Exclude<TeamMember["role"], "owner"> },
): TeamMember {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Enter a valid email.");
  if (db.team.some((m) => m.email?.toLowerCase() === email))
    throw new Error("This email is already in the team.");
  const member: TeamMember = {
    id: newId("u"),
    name: email,
    email,
    phone: "",
    role: input.role,
    active: false,
  };
  db.team.push(member);
  return member;
}

export function addDocument(
  db: Db,
  input: NewDocumentInput,
  date: ISODate,
): StoredDocument {
  if (!input.name.trim()) throw new Error("Enter a file name.");
  // Mock size; the real API stores the uploaded file and returns its size.
  const doc: StoredDocument = {
    id: newId("doc"),
    ...input,
    name: input.name.trim(),
    sizeKb: 120 + Math.floor(Math.random() * 600),
    uploadedOn: date,
  };
  db.documents.unshift(doc);
  return doc;
}

export function removeDocument(db: Db, id: ID): void {
  db.documents = db.documents.filter((d) => d.id !== id);
}

// ---------------------------------------------------------------------------
// Parties and items (masters)
// ---------------------------------------------------------------------------

const firstError = (errors: Record<string, string | undefined>) =>
  Object.values(errors).find(Boolean);

/** Tidy what the form sent: trim text, keep only digits in the phone, drop an empty GSTIN. */
export function cleanParty(input: PartyInput): PartyInput {
  return {
    ...input,
    name: input.name.trim(),
    city: input.city.trim(),
    phone: input.phone.replace(/\D/g, ""),
    gstin: input.gstin?.trim().toUpperCase() || undefined,
  };
}

export function createParty(db: Db, input: PartyInput, date: ISODate): Party {
  const p = cleanParty(input);
  const problem = firstError(checkParty(p, db.parties));
  if (problem) throw new Error(problem);
  const party: Party = {
    id: newId(p.type === "customer" ? "c" : "s"),
    ...p,
    openingDate: date,
  };
  db.parties.push(party);
  return party;
}

export function updateParty(db: Db, id: ID, input: PartyInput): Party {
  const party = db.parties.find((x) => x.id === id);
  if (!party) throw new Error("Party not found");
  const p = cleanParty(input);
  const problem = firstError(checkParty(p, db.parties, id));
  if (problem) throw new Error(problem);
  if (p.type !== party.type && db.vouchers.some((v) => v.partyId === id)) {
    throw new Error(
      `This party already has entries, so it can't be changed to a ${p.type}.`,
    );
  }
  Object.assign(party, p);
  return party;
}

export function cleanItem(input: ItemInput): ItemInput {
  return {
    ...input,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    group: input.group.trim() || "General",
    gstRate: input.taxType === "taxable" ? input.gstRate : 0,
    hsn: input.hsn.trim(),
    altUnit: input.altUnit?.name.trim()
      ? { name: input.altUnit.name.trim(), factor: input.altUnit.factor }
      : undefined,
  };
}

/** Units must be in the firm's list and switched on (an item may keep a unit that was switched off later). */
function checkItemUnits(db: Db, i: ItemInput, current?: Item) {
  const ok = (name: string, was?: string) =>
    db.units.some((u) => u.name === name && (u.enabled || name === was));
  if (!ok(i.unit, current?.unit))
    throw new Error(
      `${i.unit} isn't a switched-on unit. Add it in Settings → Units.`,
    );
  if (i.altUnit && !ok(i.altUnit.name, current?.altUnit?.name)) {
    throw new Error(
      `${i.altUnit.name} isn't a switched-on unit. Add it in Settings → Units.`,
    );
  }
}

export function createItem(db: Db, input: ItemInput): Item {
  const i = cleanItem(input);
  const problem = firstError(
    checkItem(i, db.items, undefined, gstModeOf(db.firm)),
  );
  if (problem) throw new Error(problem);
  checkItemUnits(db, i);
  const item: Item = {
    id: newId("i"),
    ...i,
    openingCost: i.openingCost ?? i.purchasePrice,
    openingBookScope:
      i.openingBookScope ??
      (gstModeOf(db.firm) === "off" || i.taxType === "nongst"
        ? "nongst"
        : "gst"),
  };
  db.items.push(item);
  return item;
}

export function updateItem(db: Db, id: ID, input: ItemInput): Item {
  const item = db.items.find((x) => x.id === id);
  if (!item) throw new Error("Item not found");
  const i = cleanItem(input);
  const problem = firstError(checkItem(i, db.items, id, gstModeOf(db.firm)));
  if (problem) throw new Error(problem);
  checkItemUnits(db, i, item);
  const used = db.vouchers.some((v) => v.lines?.some((l) => l.itemId === id));
  if (
    used &&
    (i.openingStock !== item.openingStock ||
      (i.openingCost !== undefined && i.openingCost !== item.openingCost) ||
      (i.openingBookScope !== undefined &&
        i.openingBookScope !== item.openingBookScope))
  )
    throw new Error("Opening stock is already in use and cannot be changed.");
  i.openingCost = i.openingCost ?? item.openingCost ?? item.purchasePrice;
  i.openingBookScope = i.openingBookScope ?? item.openingBookScope;
  if (used && i.unit !== item.unit) {
    throw new Error(
      "This item is already on bills, so its unit can't be changed.",
    );
  }
  Object.assign(item, i);
  if (!i.altUnit) delete item.altUnit;
  return item;
}

// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------

const unitInUse = (db: Db, name: string) =>
  db.items.filter((i) => i.unit === name || i.altUnit?.name === name).length;

export function addUnit(db: Db, input: { name: string; uqc: string }): UnitDef {
  const problem = checkUnit(input, db.units);
  if (problem) throw new Error(problem);
  const name = input.name.trim();
  const unit: UnitDef = {
    name: name[0].toUpperCase() + name.slice(1),
    uqc: input.uqc,
    enabled: true,
    builtIn: false,
  };
  db.units.push(unit);
  return unit;
}

/** Switching a unit off only hides it for new items; items already using it keep it. */
export function setUnitEnabled(
  db: Db,
  name: string,
  enabled: boolean,
): UnitDef {
  const unit = db.units.find((u) => u.name === name);
  if (!unit) throw new Error("Unit not found");
  if (!enabled && db.units.filter((u) => u.enabled).length === 1)
    throw new Error("Keep at least one unit switched on.");
  unit.enabled = enabled;
  return unit;
}

/** Only units you added yourself, and only when no item uses them. */
export function removeUnit(db: Db, name: string): void {
  const unit = db.units.find((u) => u.name === name);
  if (!unit) throw new Error("Unit not found");
  if (unit.builtIn)
    throw new Error("Built-in units can be switched off but not deleted.");
  const n = unitInUse(db, name);
  if (n)
    throw new Error(
      `${n} item${n > 1 ? "s use" : " uses"} ${name}. Change those items first.`,
    );
  db.units = db.units.filter((u) => u.name !== name);
}

export function unitUsage(db: Db): Record<string, number> {
  return Object.fromEntries(
    db.units.map((u) => [u.name, unitInUse(db, u.name)]),
  );
}

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

/** Mark the source document as converted into `into`. Party must match. */
function markConverted(db: Db, sourceId: ID, into: Voucher, partyId: ID) {
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

// ---------------------------------------------------------------------------
// Bank reconciliation, reminders, notifications
// ---------------------------------------------------------------------------

/** Mark a bank entry as seen in the bank statement on `date`, or clear the mark (null). */
export function setCleared(
  db: Db,
  id: ID,
  date: ISODate | null,
  todayIso: ISODate,
  ledgerId?: string,
): Voucher {
  const v = db.vouchers.find((x) => x.id === id);
  if (!v) throw new Error("Entry not found");
  const bank = db.ledgers.find(
    (l) =>
      l.kind === "bank" &&
      (ledgerId
        ? l.id === ledgerId
        : l.id === v.ledgerId || l.id === v.toLedgerId),
  );
  if (!bank || !ledgerEffect(v, bank.id) || v.status !== "posted")
    throw new Error("Pick a bank used by this posted entry.");
  const legacyBank =
    db.ledgers.find((l) => l.kind === "bank" && l.id === v.ledgerId) ??
    db.ledgers.find((l) => l.kind === "bank" && l.id === v.toLedgerId);
  const clearings =
    v.bankClearings ??
    (v.clearedOn && legacyBank ? { [legacyBank.id]: v.clearedOn } : {});
  const was = bankClearedOn(v, bank.id);
  const change = (now?: ISODate) =>
    logAudit(db, "bank-date", v, [
      {
        field: `Bank date: ${bank.name}`,
        before: was ? formatDate(was) : "—",
        after: now ? formatDate(now) : "—",
      },
    ]);
  if (date === null) {
    v.bankClearings = { ...clearings };
    delete v.bankClearings[bank.id];
    if (!ledgerId || bank.id === v.ledgerId) delete v.clearedOn;
    if (was) change(undefined);
    return v;
  }
  if (date < v.date)
    throw new Error("The bank date can't be before the entry date.");
  if (date > todayIso) throw new Error("The bank date can't be in the future.");
  v.bankClearings = { ...clearings, [bank.id]: date };
  if (!ledgerId || bank.id === v.ledgerId) v.clearedOn = date;
  if (was !== date) change(date);
  return v;
}

export function updateReminders(
  db: Db,
  patch: Partial<ReminderSettings>,
): ReminderSettings {
  const next = { ...db.reminders, ...patch };
  for (const k of ["daysBefore", "repeatEvery"] as const) {
    if (!Number.isInteger(next[k]) || next[k] < 0 || next[k] > 60)
      throw new Error("Days must be a whole number from 0 to 60.");
  }
  if (next.minAmount < 0) throw new Error("Minimum amount can't be negative.");
  db.reminders = next;
  return next;
}

export function markReminded(db: Db, partyId: ID, date: ISODate): void {
  findParty(db, partyId);
  db.remindedOn[partyId] = date;
}

export function markNoticesRead(db: Db, ids: string[]): void {
  db.readNotices = [...new Set([...db.readNotices, ...ids])].slice(-500);
}
