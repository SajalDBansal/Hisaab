/**
 * Shared data types for Hisaab.
 *
 * These shapes are what the mock services return today and what the real
 * REST API should return later, so the backend can reuse this file.
 *
 * Money rule: every amount is an integer number of PAISE (₹1 = 100 paise).
 * Never store rupees as decimals — use helpers in `money.ts` to convert.
 */

/** Integer amount in paise. ₹12.50 is stored as 1250. */
export type Paise = number;
import type { DeliverySnapshot, CommissionSnapshot } from "./associateTypes";
import type { OpeningBill } from "./accounting/openingImport";
export type { DeliverySnapshot, CommissionSnapshot } from "./associateTypes";

/** Date as an ISO string "YYYY-MM-DD" (no time, no timezone). */
export type ISODate = string;

export type ID = string;

// ---------------------------------------------------------------------------
// Firm
// ---------------------------------------------------------------------------

/**
 * How the firm deals with GST (chosen when the firm is created, changeable in Firm profile):
 *   regular       – charges GST on sales, claims input tax on purchases (GSTR-1, GSTR-3B)
 *   composition   – can't charge GST; issues bills of supply; pays a flat % of turnover (CMP-08)
 *   unregistered  – GST switched off: no GST anywhere in the app
 */
export type GstRegistration = "regular" | "composition" | "unregistered";

/** Same choice as the app talks about it. `off` = not registered, GST hidden. */
export type GstMode = "regular" | "composition" | "off";

/** Composition rate depends on the business: traders/manufacturers 1%, restaurants 5%, other services 6%. */
export type CompositionType = "trader" | "restaurant" | "services";

export interface Firm {
  id: ID;
  name: string;
  city: string;
  state: string;
  /** Two-digit GST state code, e.g. "09" for Uttar Pradesh. */
  stateCode: string;
  gstin: string;
  gstRegistration: GstRegistration;
  /** Composition firms only: decides the flat tax rate. */
  compositionType?: CompositionType;
  /** First day of the current financial year, e.g. "2026-04-01". */
  fyStart: ISODate;
  /** Printed on invoices. */
  address?: string;
  phone?: string;
  email?: string;
  pan?: string;
}

/** Firm fields the owner can edit in Settings. */
export type FirmUpdate = Partial<
  Pick<
    Firm,
    | "name"
    | "address"
    | "city"
    | "phone"
    | "email"
    | "gstin"
    | "pan"
    | "gstRegistration"
    | "compositionType"
  >
>;

// ---------------------------------------------------------------------------
// Parties (customers and suppliers)
// ---------------------------------------------------------------------------

export type PartyType = "customer" | "supplier";

export interface Party {
  version?: number;
  id: ID;
  name: string;
  type: PartyType;
  phone: string;
  city: string;
  stateCode: string;
  /** Empty for unregistered parties. */
  gstin?: string;
  /** Days of credit allowed; used to compute the due date of a bill. */
  creditDays: number;
  /** 0 means no credit limit. */
  creditLimit: Paise;
  /**
   * Opening balance on the books-beginning date.
   * Positive = they owe us (receivable), negative = we owe them (payable).
   */
  openingBalance: Paise;
  /** Explicit GST share; the remainder belongs to the non-GST book. */
  openingGstBalance?: Paise;
  openingDate: ISODate;
  /** Immutable bill-wise partition of the net opening; never an additional balance. */
  openingBills?: OpeningBill[];
}

/** What the party form sends when adding or editing a party. */
export type PartyInput = Omit<
  Party,
  "id" | "version" | "openingDate" | "openingGstBalance" | "openingBills"
>;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type GstRate = 0 | 5 | 18 | 40;

/**
 * How GST treats an item:
 *   taxable — GST at 5, 18 or 40%
 *   nil     — nil-rated, GST at 0% (e.g. salt)
 *   exempt  — exempt from GST (e.g. fresh milk, loose atta)
 *   nongst  — outside GST altogether (e.g. petrol, diesel, liquor); billed separately
 */
export type TaxType = "taxable" | "nil" | "exempt" | "nongst";

/** Report filter: GST = goods/bills with GST charged, Non-GST = nil, exempt and non-GST. */
export type TaxScope = "all" | "gst" | "nongst";
export type BookScope = Exclude<TaxScope, "all">;

/**
 * Sale document: Tax invoice when any line has GST, otherwise Bill of supply.
 * Composition firms always issue a Bill of supply; firms without GST a plain Invoice.
 */
export type SaleDocType = "tax-invoice" | "bill-of-supply" | "invoice";

export interface AltUnit {
  /** e.g. "Box" */
  name: string;
  /** How many base units in one alternate unit, e.g. 1 Box = 12 Nos. */
  factor: number;
}

export interface Item {
  version?: number;
  id: ID;
  name: string;
  code: string;
  hsn: string;
  group: string;
  /** Taxable items use 5/18/40%; the other types always have gstRate 0. */
  taxType: TaxType;
  gstRate: GstRate;
  /** Base unit, e.g. "Nos" or "Kg". Quantities are stored in this unit. */
  unit: string;
  altUnit?: AltUnit;
  /** Prices are per base unit. */
  purchasePrice: Paise;
  salePrice: Paise;
  mrp: Paise;
  reorderLevel: number;
  openingStock: number;
  /** Opening valuation is independent of the editable default buying price. */
  openingCost?: Paise;
  openingBookScope?: BookScope;
  openingLots?: OpeningStockLot[];
  batch?: { number: string; expiry: ISODate };
}

/** A unit of measure the firm uses, e.g. Nos, Kg, Tray. */
export interface UnitDef {
  /** Shown on bills and stock, e.g. "Kg". Items store this name. */
  name: string;
  /** GST unit quantity code, e.g. "KGS" (used in GSTR-1). */
  uqc: string;
  /** Switched-off units are hidden when adding items. */
  enabled: boolean;
  /** Comes with the app (can be switched off, not deleted). */
  builtIn: boolean;
}

/** What the item form sends when adding or editing an item. */
export type ItemInput = Omit<Item, "id">;

export interface OpeningStockLot {
  id: string;
  qty: number;
  unitCost: Paise;
  bookScope: BookScope;
}

/** Frozen lot movement paired with a balanced journal, never a taxable invoice. */
export interface InventoryAdjustment {
  kind: "count" | "damage" | "landed-cost" | "reversal";
  itemId: ID;
  lotId: string;
  quantity: number;
  value: Paise;
  reason: string;
  reversesId?: ID;
}

// ---------------------------------------------------------------------------
// Ledgers (only the ones the app needs to pick today)
// ---------------------------------------------------------------------------

export type LedgerKind = "cash" | "bank";

export interface Ledger {
  id: ID;
  name: string;
  kind: LedgerKind;
  /** Short label for lists, e.g. "HDFC ··4521". */
  shortName: string;
  openingBalance: Paise;
  openingGstBalance?: Paise;
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export type VoucherType =
  | "sale"
  | "purchase"
  | "receipt"
  | "payment"
  | "expense"
  | "journal"
  /** Sales return: goods back from a customer, reduces what they owe. */
  | "credit-note"
  /** Purchase return: goods back to a supplier, reduces what we owe. */
  | "debit-note"
  /** Money moved between cash and bank (deposit, withdrawal, bank to bank). */
  | "contra"
  // Documents that don't touch the books until they become a bill:
  /** Quotation for a customer. */
  | "estimate"
  /** Customer's confirmed order. */
  | "sales-order"
  /** Goods sent before the invoice (delivery challan). Moves stock until it is billed. */
  | "delivery-note"
  /** Order placed with a supplier. */
  | "purchase-order";

/** Estimates and orders: they turn into a bill (or another document) later. */
export type OrderType =
  "estimate" | "sales-order" | "delivery-note" | "purchase-order";

export type VoucherStatus = "draft" | "posted" | "cancelled";

export type PaymentMode = "cash" | "upi" | "bank" | "cheque" | "card";

/** Monetary components frozen when a goods return is issued. */
export interface ReturnAmounts {
  taxable: Paise;
  discount: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  roundOff: Paise;
}

/** One item row on a sale or purchase invoice. */
export interface InvoiceLine {
  /** Issued return components; absent on historical notes that used invoice maths. */
  returnAmounts?: ReturnAmounts;
  orderLineId?: ID;
  orderSourceLineId?: ID;
  stockFulfilledById?: ID;
  /** Stable purchase lot, shared by sales and returns using that stock. */
  stockLotId?: string;
  stockCost?: Paise;
  bookScope?: BookScope;
  itemId: ID;
  /** Quantity as entered: in the item's base unit, or in `per.unit` when set (e.g. 2 Box). */
  qty: number;
  /** Rate per the same unit as `qty`. */
  rate: Paise;
  /**
   * Set when the quantity was entered in the item's second unit, e.g. { unit: "Box", factor: 12 }.
   * The factor is saved with the bill, so changing the item later doesn't change old bills.
   * Stock moves by qty × factor base units.
   */
  per?: { unit: string; factor: number };
  /** Discount as a percentage (0-100). Use either this or discountAmount. */
  discountPercent?: number;
  /** Flat discount for the whole line. */
  discountAmount?: Paise;
  gstRate: GstRate;
  /** Copied from the item when the bill is saved. Missing on old data = taxable (or nil at 0%). */
  taxType?: TaxType;
  /** Credit/debit notes only: index of the line on the original bill being returned. */
  sourceLine?: number;
  /**
   * Saved with exact whole-number maths for qty × rate and percentage discounts.
   * Missing on older lines, which keep the floating-point totals they were issued with.
   */
  exactMath?: boolean;
}

/** Freight, packing etc. added on top of the items. */
export interface ExtraCharge {
  name: string;
  amount: Paise;
  gstRate: GstRate;
}

/** Part of a receipt/payment that settles a specific bill. */
export interface Allocation {
  /** The sale or purchase voucher being settled. */
  voucherId: ID;
  amount: Paise;
}

export interface Voucher {
  inventoryAdjustment?: InventoryAdjustment;
  delivery?: DeliverySnapshot;
  commission?: CommissionSnapshot;
  fulfillmentManaged?: boolean;
  fulfillmentStatus?: "open" | "partial" | "converted";
  settlementKind?: string;
  settlementSourceVoucherId?: ID;
  settlementLocked?: boolean;
  settlementAllocations?: Allocation[];
  bookScope?: BookScope;
  version?: number;
  id: ID;
  type: VoucherType;
  /** Human number, e.g. "SI/26-27/0149". */
  number: string;
  date: ISODate;
  status: VoucherStatus;
  partyId?: ID;
  /** Master details frozen when issued; legacy snapshots use the migration-time values. */
  snapshot?: VoucherSnapshot;

  // Sale / purchase
  lines?: InvoiceLine[];
  charges?: ExtraCharge[];
  /** True when the party is in another state (IGST instead of CGST + SGST). */
  interState?: boolean;
  dueDate?: ISODate;
  /** Supplier's own invoice number, purchases only. */
  supplierInvoiceNo?: string;
  /** Sales only: Tax invoice or Bill of supply (decided from the lines when saved). */
  docType?: SaleDocType;
  /**
   * The firm's GST mode when this voucher was saved (missing = regular, older data).
   * Kept on the voucher so a firm that registers later doesn't change old bills.
   */
  taxMode?: GstMode;
  /** Credit/debit notes: the sale or purchase bill being returned against. */
  againstId?: ID;
  /** Credit/debit notes: why the goods came back, e.g. "Damaged". */
  noteReason?: string;
  /** Set when the voucher is cancelled. */
  cancelReason?: string;
  cancelledAt?: string;
  /** Set when an invoice is edited after saving. */
  editedAt?: string;
  /** Contra: the cash/bank ledger the money went into (`ledgerId` is where it came from). */
  toLedgerId?: ID;
  /** Bank reconciliation: the date this entry showed up in the bank statement. */
  clearedOn?: ISODate;
  bankClearings?: Record<string, ISODate>;
  /** Estimates: quote valid until this date. */
  validUntil?: ISODate;
  /** The estimate / order this voucher was made from. */
  sourceId?: ID;
  /** Estimates / orders: the voucher it was turned into (it then stops being "open"). */
  convertedToId?: ID;

  // Receipt / payment / expense
  mode?: PaymentMode;
  /** Cash or bank ledger the money went in or out of. */
  ledgerId?: ID;
  reference?: string;
  allocations?: Allocation[];
  /** For expenses: what the money was spent on, e.g. "Freight". */
  expenseHead?: string;
  /** Payments only: tax deducted at source and kept back from the supplier. */
  tds?: TdsDeduction;

  /** Journals only: the free Dr/Cr lines. */
  journalLines?: JournalLine[];

  /**
   * Final amount of the voucher in paise.
   * For invoices this is the rounded grand total from `calcInvoice`.
   */
  amount: Paise;
  narration?: string;
  /** Saved on the phone but not yet sent to the server. */
  pendingSync?: boolean;
  createdAt: string;
}

export interface VoucherSnapshot {
  source: "issued" | "legacy";
  firm: Firm;
  party?: Party;
  items: Item[];
  units: UnitDef[];
  settings: InvoiceSettings;
  bankName?: string;
}

/**
 * One line of a journal entry. `account` is an account key (see accounting/accounts.ts),
 * e.g. "expense:Salary", "party:c1" or "ledger:hdfc". Use either debit or credit, not both.
 */
export interface JournalLine {
  account: string;
  /** Display name saved with the line, e.g. "Salary". */
  name: string;
  debit: Paise;
  credit: Paise;
}

/** TDS kept back on a payment. `amount` is in paise; `rate` is a percentage (e.g. 2 or 0.1). */
export interface TdsDeduction {
  section: string;
  rate: number;
  amount: Paise;
}

// ---------------------------------------------------------------------------
// Inputs used by the create screens
// ---------------------------------------------------------------------------

/** A new sale or purchase invoice. */
export interface NewInvoiceInput {
  creditOverrideId?: ID;
  delivery?: { associateId: ID; reference: string } | null;
  commission?: { associateId: ID; rate?: number } | null;
  bookScope?: BookScope;
  partyId: ID;
  date: ISODate;
  lines: InvoiceLine[];
  charges: ExtraCharge[];
  /** Purchases only: the supplier's own bill number. */
  supplierInvoiceNo?: string;
  /** Money received (sale) or paid (purchase) at the same time. Saved as a linked receipt/payment. */
  paidNow?: { amount: Paise; mode: PaymentMode; ledgerId: ID };
  narration?: string;
  /** The estimate / order this bill is made from; it is marked as converted. */
  sourceId?: ID;
}

/** A new receipt (money in from a customer) or payment (money out to a supplier). */
export interface NewMoneyInput {
  bookScope?: BookScope;
  partyId: ID;
  date: ISODate;
  /** Money that actually moved in or out of the cash/bank account. */
  amount: Paise;
  mode: PaymentMode;
  ledgerId: ID;
  reference?: string;
  /** Bills settled. For payments with TDS these can add up to amount + TDS. */
  allocations: Allocation[];
  /** Payments only. */
  tds?: TdsDeduction;
  narration?: string;
}

/** Money spent on a business expense (rent, freight, electricity …). */
export interface NewExpenseInput {
  bookScope?: BookScope;
  date: ISODate;
  expenseHead: string;
  amount: Paise;
  mode: PaymentMode;
  ledgerId: ID;
  narration?: string;
}

/** A journal entry: any accounts, debits must equal credits. */
export interface NewJournalInput {
  bookScope?: BookScope;
  date: ISODate;
  lines: JournalLine[];
  narration?: string;
}

// ---------------------------------------------------------------------------
// Settings, team and documents
// ---------------------------------------------------------------------------

export type InvoiceTemplate = "classic" | "modern" | "compact";

export interface InvoiceSettings {
  template: InvoiceTemplate;
  /** Printed at the bottom of every sale invoice. */
  terms: string;
  showBankDetails: boolean;
  /** Bank ledger whose details are printed when showBankDetails is on. */
  bankLedgerId: ID;
  /** Printed under "Bank details" so customers can pay. */
  bankAccount?: BankAccount;
  /** Voucher number prefix per type, e.g. sale → "SI" gives "SI/26-27/0001". */
  prefixes: Record<VoucherType, string>;
  /** Sales with no GST (only nil, exempt or non-GST goods) get their own series, e.g. "BS/26-27/0001". */
  billOfSupplyPrefix: string;
}

export type Role = "owner" | "accountant" | "sales" | "viewer";

export interface TeamMember {
  id: ID;
  name: string;
  phone: string;
  email?: string;
  role: Role;
  /** False until the invite is accepted. */
  active: boolean;
  lastActive?: ISODate;
}

export type DocumentKind =
  "bill" | "receipt" | "certificate" | "agreement" | "other";

/** A file kept against the books, e.g. a scanned supplier bill. */
export interface StoredDocument {
  id: ID;
  name: string;
  kind: DocumentKind;
  sizeKb: number;
  hasThumbnail?: boolean;
  uploadedOn: ISODate;
  contentType?:
    | "application/pdf"
    | "image/jpeg"
    | "image/png"
    | "image/heic"
    | "image/heif";
  folder?: string;
  accountKey?: string;
  entryDate?: ISODate;
  partyId?: ID;
  voucherId?: ID;
  note?: string;
}

export interface NewDocumentInput {
  name: string;
  kind: DocumentKind;
  partyId?: ID;
  voucherId?: ID;
  accountKey?: string;
  folder?: string;
  note?: string;
}

export interface DocumentFile {
  uri: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface DocumentFilters {
  kinds?: DocumentKind[];
  partyIds?: ID[];
  accountKeys?: string[];
  voucherId?: ID;
  from?: ISODate;
  to?: ISODate;
  dateBy?: "entry" | "upload";
  folder?: string;
  search?: string;
}

/** A sales or purchase return: which lines of the original bill and how many come back. */
export interface NewNoteInput {
  /** The sale (credit note) or purchase (debit note) being returned against. */
  againstId: ID;
  date: ISODate;
  /** `index` is the line's position on the original bill; `qty` is in that line's unit. */
  lines: { index: number; qty: number }[];
  reason: string;
  narration?: string;
}

/** Bank account printed on invoices. */
export interface BankAccount {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  /** e.g. "shreekrishna@hdfcbank" */
  upiId?: string;
}

/** Cash ↔ bank or bank ↔ bank transfer. */
export interface NewContraInput {
  bookScope?: BookScope;
  date: ISODate;
  fromLedgerId: ID;
  toLedgerId: ID;
  amount: Paise;
  reference?: string;
  narration?: string;
}

/** Estimate, sales order, delivery note or purchase order. */
export interface NewOrderInput {
  delivery?: { associateId: ID; reference: string } | null;
  commission?: { associateId: ID; rate?: number } | null;
  partyId: ID;
  date: ISODate;
  lines: InvoiceLine[];
  charges: ExtraCharge[];
  /** Estimates only. Defaults to 15 days after the date. */
  validUntil?: ISODate;
  /** Made from another document, e.g. a sales order from an estimate. */
  sourceId?: ID;
  narration?: string;
}

// ---------------------------------------------------------------------------
// App settings: payment reminders and firms
// ---------------------------------------------------------------------------

/** When customers get a WhatsApp payment reminder. */
export interface ReminderSettings {
  enabled: boolean;
  /** Remind this many days before the due date (0 = don't). */
  daysBefore: number;
  /** Remind on the due date itself. */
  onDueDate: boolean;
  /** While overdue, remind again every this many days (0 = only once). */
  repeatEvery: number;
  /** Skip customers who owe less than this. */
  minAmount: Paise;
}

/** Details asked when adding another firm (business) to the app. */
export interface NewFirmInput {
  name: string;
  city: string;
  stateCode: string;
  gstin?: string;
  gstRegistration: GstRegistration;
  compositionType?: CompositionType;
}

// ---------------------------------------------------------------------------
// Edit history (audit trail) — Companies (Accounts) Rules, Rule 3(1)
// ---------------------------------------------------------------------------

export type AuditAction =
  "created" | "edited" | "cancelled" | "converted" | "reopened" | "bank-date";

/** One field that changed, in words: { field: "Amount", before: "₹1,000.00", after: "₹1,200.00" }. */
export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

/** One line of the edit log. Entries are only ever added, never changed or removed. */
export interface AuditEntry {
  id: ID;
  voucherId: ID;
  /** Voucher number and type at the time, so the log reads on its own. */
  number: string;
  voucherType: VoucherType;
  action: AuditAction;
  /** ISO date-time */
  at: string;
  userId: ID;
  userName: string;
  changes: AuditChange[];
  note?: string;
}
