import { z } from "zod";
import { InvoiceTotals } from "./invoiceTotals";
import {
  GstRate,
  Id,
  IsoDate,
  IsoDateTime,
  Paise,
  PositivePaise,
  NonNegativePaise,
  Quantity,
  Percentage,
  requiredText,
} from "./common";
import { Item, TaxType, Unit, BookScope } from "./items";
import { Firm } from "./firms";
import { Party } from "./parties";
import { GstMode, InvoiceTemplate, InvoiceSettings } from "./settings";
import { InventoryAdjustment } from "./inventory";
import {
  DeliverySnapshot,
  CommissionSnapshot,
  InvoiceAssociatesInput,
} from "./associates";

export const VoucherType = z.enum([
  "sale",
  "purchase",
  "receipt",
  "payment",
  "expense",
  "journal",
  "credit-note",
  "debit-note",
  "contra",
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
]);
export const OrderType = z.enum([
  "estimate",
  "sales-order",
  "delivery-note",
  "purchase-order",
]);
export const VoucherStatus = z.enum(["draft", "posted", "cancelled"]);
export const InvoiceStatus = z.enum([
  "draft",
  "cancelled",
  "paid",
  "partial",
  "overdue",
  "unpaid",
]);
export const OrderStatus = z.enum([
  "open",
  "partial",
  "converted",
  "expired",
  "cancelled",
]);
export const PaymentMode = z.enum(["cash", "upi", "bank", "cheque", "card"]);
export const SaleDocType = z.enum(["tax-invoice", "bill-of-supply", "invoice"]);

// ---------------------------------------------------------------------------
// Pieces of a voucher
// ---------------------------------------------------------------------------

/** One item row. Quantity and rate are in `per.unit` when set, otherwise in the item's base unit. */
/** The customer or supplier. A missing value gets a friendly message. */
const PartyId = z.uuid({ error: "Pick the customer or supplier." });

const InputInvoiceLine = z
  .object({
    itemId: Id,
    stockLotId: z.string().min(1).max(160).optional(),
    stockCost: NonNegativePaise.optional(),
    bookScope: BookScope.optional(),
    qty: Quantity.positive("Quantity must be more than 0."),
    // Rate per unit, in paise
    rate: Paise.positive("Enter a rate."),
    per: z
      .object({ unit: z.string().min(1), factor: Quantity.positive() })
      .optional(),
    discountPercent: Percentage.optional(),
    discountAmount: NonNegativePaise.optional(),
    gstRate: GstRate,
    taxType: TaxType.optional(),
    // Credit/debit notes: position of the returned line on the original bill
    sourceLine: z.number().int().min(0).optional(),
  })
  .refine((l) => !(l.discountPercent && l.discountAmount), {
    path: ["discountPercent"],
    message: "Use either a percentage or an amount for the discount, not both.",
  });

export const ReturnAmounts = z.object({
  taxable: NonNegativePaise,
  discount: NonNegativePaise,
  cgst: NonNegativePaise,
  sgst: NonNegativePaise,
  igst: NonNegativePaise,
  roundOff: Paise,
});

// Calculated amounts and fulfillment metadata are output-only.
export const InvoiceLine = InputInvoiceLine.safeExtend({
  returnAmounts: ReturnAmounts.optional(),
  exactMath: z.boolean().optional(),
  orderLineId: Id.optional(),
  orderSourceLineId: Id.optional(),
  stockFulfilledById: Id.optional(),
});

export const ExtraCharge = z.object({
  name: requiredText("Name the charge, like Freight.", 60),
  amount: NonNegativePaise,
  gstRate: GstRate,
});

export const Allocation = z.object({
  voucherId: z.string().min(1),
  amount: PositivePaise,
});

export const JournalLine = z
  .object({
    account: z.string().min(1, "Pick an account."),
    name: z.string().min(1),
    debit: NonNegativePaise,
    credit: NonNegativePaise,
  })
  .refine((l) => !(l.debit > 0 && l.credit > 0), {
    message: "Use either Dr or Cr, not both.",
  })
  .refine((l) => l.debit > 0 || l.credit > 0, { message: "Enter an amount." });

export const TdsDeduction = z.object({
  section: z.string().min(1),
  rate: Percentage,
  amount: NonNegativePaise,
});

// ---------------------------------------------------------------------------
// What the create screens send
// ---------------------------------------------------------------------------

/** New sale or purchase. `paidNow` is saved as a linked receipt / payment. */
export const NewInvoiceInput = z.object({
  ...InvoiceAssociatesInput.shape,
  creditOverrideId: Id.optional(),
  bookScope: BookScope.optional(),
  partyId: PartyId,
  date: IsoDate,
  lines: z.array(InputInvoiceLine).min(1, "Add at least one item."),
  charges: z.array(ExtraCharge),
  supplierInvoiceNo: z.string().max(60).optional(),
  paidNow: z
    .object({ amount: PositivePaise, mode: PaymentMode, ledgerId: Id })
    .optional(),
  narration: z.string().max(500).optional(),
  sourceId: Id.optional(),
});

export const NewMoneyInput = z.object({
  bookScope: BookScope.optional(),
  partyId: PartyId,
  date: IsoDate,
  amount: PositivePaise.describe("Money that actually moved"),
  mode: PaymentMode,
  ledgerId: Id,
  reference: z.string().max(60).optional(),
  allocations: z.array(Allocation),
  tds: TdsDeduction.optional(),
  narration: z.string().max(500).optional(),
});

export const NewExpenseInput = z.object({
  bookScope: BookScope.optional(),
  date: IsoDate,
  expenseHead: requiredText("Pick what it was spent on.", 60),
  amount: PositivePaise,
  mode: PaymentMode,
  ledgerId: Id,
  narration: z.string().max(500).optional(),
});

/** Journal entry: at least two lines, and debits must equal credits. */
export const NewJournalInput = z
  .object({
    bookScope: BookScope.optional(),
    date: IsoDate,
    lines: z.array(JournalLine).min(2, "Add at least two lines."),
    narration: z.string().max(500).optional(),
  })
  .superRefine((entry, ctx) => {
    const debit = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const credit = entry.lines.reduce((sum, l) => sum + l.credit, 0);
    if (debit !== credit)
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message:
          debit > credit
            ? "Debits are more than credits."
            : "Credits are more than debits.",
      });
  });

export const NewContraInput = z
  .object({
    bookScope: BookScope.optional(),
    date: IsoDate,
    fromLedgerId: Id,
    toLedgerId: Id,
    amount: PositivePaise,
    reference: z.string().max(60).optional(),
    narration: z.string().max(500).optional(),
  })
  .refine((c) => c.fromLedgerId !== c.toLedgerId, {
    path: ["toLedgerId"],
    message: "Pick two different accounts.",
  });

/** Estimate, sales order, delivery note or purchase order (the type is in the URL). */
export const NewOrderInput = z.object({
  ...InvoiceAssociatesInput.shape,
  partyId: PartyId,
  date: IsoDate,
  lines: z.array(InputInvoiceLine).min(1, "Add at least one item."),
  charges: z.array(ExtraCharge),
  validUntil: IsoDate.optional(),
  sourceId: Id.optional(),
  narration: z.string().max(500).optional(),
});

/** A return: which lines of the original bill, and how many, come back. */
export const NewNoteInput = z.object({
  againstId: Id,
  date: IsoDate,
  lines: z
    .array(
      z.object({
        index: z.number().int().min(0),
        qty: Quantity.positive("Enter how many came back."),
      }),
    )
    .min(1, "Pick at least one item to return.")
    .refine(
      (lines) => new Set(lines.map((line) => line.index)).size === lines.length,
      "Pick each bill line only once.",
    ),
  reason: requiredText("Say why the goods came back.", 120),
  narration: z.string().max(500).optional(),
});

export const CancelInput = z.object({
  reason: requiredText("Say why you're cancelling.", 200),
});

export const BankDateInput = z.object({
  clearedOn: IsoDate.nullable(),
  ledgerId: Id.optional(),
});

// ---------------------------------------------------------------------------
// What the server sends back
// ---------------------------------------------------------------------------

export const VoucherSnapshot = z.object({
  source: z.enum(["issued", "legacy"]),
  firm: Firm,
  party: Party.optional(),
  items: z.array(Item),
  units: z.array(Unit),
  settings: InvoiceSettings.extend({ bankLedgerId: z.string() }),
  bankName: z.string().optional(),
});

export const Voucher = z.object({
  delivery: DeliverySnapshot.optional(),
  commission: CommissionSnapshot.optional(),
  fulfillmentManaged: z.boolean().optional(),
  fulfillmentStatus: z.enum(["open", "partial", "converted"]).optional(),
  settlementKind: z.string().optional(),
  settlementSourceVoucherId: Id.optional(),
  settlementLocked: z.boolean().optional(),
  settlementAllocations: z
    .array(z.object({ voucherId: z.string().min(1), amount: Paise }))
    .optional(),
  inventoryAdjustment: InventoryAdjustment.optional(),
  bookScope: BookScope.optional(),
  id: Id,
  type: VoucherType,
  number: z.string(),
  date: IsoDate,
  status: VoucherStatus,
  partyId: Id.optional(),
  snapshot: VoucherSnapshot.optional(),
  lines: z.array(InvoiceLine).optional(),
  charges: z.array(ExtraCharge).optional(),
  interState: z.boolean().optional(),
  dueDate: IsoDate.optional(),
  supplierInvoiceNo: z.string().optional(),
  docType: SaleDocType.optional(),
  taxMode: GstMode.optional(),
  againstId: Id.optional(),
  noteReason: z.string().optional(),
  cancelReason: z.string().optional(),
  cancelledAt: IsoDateTime.optional(),
  editedAt: IsoDateTime.optional(),
  toLedgerId: Id.optional(),
  clearedOn: IsoDate.optional(),
  bankClearings: z.record(Id, IsoDate).optional(),
  validUntil: IsoDate.optional(),
  sourceId: Id.optional(),
  convertedToId: Id.optional(),
  mode: PaymentMode.optional(),
  ledgerId: Id.optional(),
  reference: z.string().optional(),
  allocations: z.array(Allocation).optional(),
  expenseHead: z.string().optional(),
  tds: TdsDeduction.optional(),
  journalLines: z.array(JournalLine).optional(),
  amount: Paise,
  narration: z.string().optional(),
  createdAt: IsoDateTime,
  /** Goes up on every change; send it back as `If-Match` when editing. */
  version: z.number().int(),
});

export const VoucherListQuery = z.object({
  type: VoucherType.optional(),
  types: z.string().max(200).optional(),
  partyId: Id.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  status: VoucherStatus.optional(),
  search: z.string().max(100).optional(),
});

export const InvoiceListQuery = z.object({
  type: z.enum(["sale", "purchase"]),
});

export const OrderListQuery = z.object({
  type: OrderType,
});

export const NextNumberQuery = z.object({
  type: VoucherType,
  series: z.enum(["bos", "nongst"]).optional(),
  date: IsoDate.optional(),
});

export const PrintableVoucherQuery = z.object({
  template: InvoiceTemplate.optional(),
});

const Posting = z.object({
  account: z.string(),
  ledger: z.string(),
  debit: Paise,
  credit: Paise,
});

const PostingTotals = z.object({
  debit: Paise,
  credit: Paise,
  difference: Paise,
  balanced: z.boolean(),
});

const LinkedVoucher = z.object({
  id: Id,
  number: z.string(),
  type: VoucherType,
  date: IsoDate.optional(),
});

const VoucherAuditEntry = z.object({
  id: Id,
  voucherId: Id,
  number: z.string(),
  voucherType: VoucherType,
  action: z.enum([
    "created",
    "edited",
    "cancelled",
    "converted",
    "reopened",
    "bank-date",
  ]),
  at: IsoDateTime,
  userId: Id,
  userName: z.string(),
  changes: z.array(
    z.object({ field: z.string(), before: z.string(), after: z.string() }),
  ),
  note: z.string().optional(),
});

export const InvoiceRow = z.object({
  voucher: Voucher,
  partyName: z.string(),
  settled: Paise,
  pending: Paise,
  status: InvoiceStatus,
});

export const OrderRow = z.object({
  voucher: Voucher,
  partyName: z.string(),
  status: OrderStatus,
  convertedTo: z.object({ id: Id, number: z.string() }).optional(),
});

export const ReturnableBill = z.object({
  bill: Voucher,
  partyName: z.string(),
  lines: z.array(
    z.object({
      index: z.number().int(),
      itemName: z.string(),
      unit: z.string(),
      qty: z.number(),
      returned: z.number(),
      returnable: z.number(),
      rate: Paise,
      amountBasis: z.object({
        qty: Quantity,
        returnedQty: Quantity,
        original: ReturnAmounts,
        returned: ReturnAmounts,
      }),
    }),
  ),
});

export const VoucherDetail = Voucher.extend({
  voucher: Voucher,
  party: Party.optional(),
  items: z.array(Item),
  ledgerName: z.string().optional(),
  totals: InvoiceTotals.optional(),
  postings: z.array(Posting),
  postingTotals: PostingTotals,
  settled: Paise,
  payments: z.array(Voucher),
  allocatedTo: z.array(
    z.object({ voucherId: z.string(), number: z.string(), amount: Paise }),
  ),
  against: z.object({ id: Id, number: z.string() }).optional(),
  returns: z.array(Voucher),
  cancelBlocker: z.string().nullable(),
  editBlocker: z.string().nullable(),
  toLedgerName: z.string().optional(),
  canConvertTo: z.array(
    z.enum([
      "sale",
      "purchase",
      "estimate",
      "sales-order",
      "delivery-note",
      "purchase-order",
    ]),
  ),
  source: LinkedVoucher.optional(),
  convertedTo: LinkedVoucher.optional(),
  history: z.array(VoucherAuditEntry),
});

export const NextNumber = z.string();

export const PrintableVoucher = z.object({
  title: z.string(),
  html: z.string(),
  fileName: z.string(),
  shareText: z.string(),
  phone: z.string().optional(),
});

export type VoucherType = z.infer<typeof VoucherType>;
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;
export type OrderStatus = z.infer<typeof OrderStatus>;
export type InvoiceLine = z.infer<typeof InvoiceLine>;
export type NewInvoiceInput = z.infer<typeof NewInvoiceInput>;
export type NewMoneyInput = z.infer<typeof NewMoneyInput>;
export type NewExpenseInput = z.infer<typeof NewExpenseInput>;
export type NewJournalInput = z.infer<typeof NewJournalInput>;
export type NewContraInput = z.infer<typeof NewContraInput>;
export type NewOrderInput = z.infer<typeof NewOrderInput>;
export type NewNoteInput = z.infer<typeof NewNoteInput>;
export type Voucher = z.infer<typeof Voucher>;
export type InvoiceRow = z.infer<typeof InvoiceRow>;
export type OrderRow = z.infer<typeof OrderRow>;
export type ReturnableBill = z.infer<typeof ReturnableBill>;
export type VoucherDetail = z.infer<typeof VoucherDetail>;
export type PrintableVoucher = z.infer<typeof PrintableVoucher>;

export const VoucherListParams = VoucherListQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/** `/orders/:type` — estimate, sales-order, delivery-note or purchase-order. */
export const OrderParams = z.object({ type: OrderType });
