import type {
  AuditEntry,
  Firm,
  ISODate,
  VoucherType,
  TaxScope,
} from "../types";
import type { Books } from "../accounting/generalLedger";

export const REPORT_IDS = [
  "trial-balance",
  "balance-sheet",
  "profit-loss",
  "comparative-profit-loss",
  "cash-movement",
  "daybook",
  "journal",
  "general-ledger",
  "cash-book",
  "bank-book",
  "sales-register",
  "purchase-register",
  "credit-notes",
  "debit-notes",
  "receipts",
  "payments",
  "expenses",
  "receivables",
  "payables",
  "stock",
  "tax-ledgers",
  // Phase 1 (doc 37)
  "profit-loss-t",
  "balance-sheet-t",
  "itc-at-risk",
  "interest-calculator",
  "customer-tracking",
  "top-customers",
  "top-suppliers",
  "sales-by-party",
  "sales-by-item",
  "purchases-by-party",
  "purchases-by-item",
  "expenses-by-party",
  "estimates-register",
  "proformas-register",
  "sales-orders-register",
  "delivery-notes-register",
  "purchase-orders-register",
  "gstr2",
  "tax-summary",
  "audit-trail",
] as const;

export type ReportId = (typeof REPORT_IDS)[number];
export interface ReportDefinition {
  title: string;
  category: string;
  asOf?: boolean;
  accounts?: "all" | "cash" | "bank";
  parties?: boolean;
  zeroBalances?: boolean;
}

export const REPORTS: Record<ReportId, ReportDefinition> = {
  "trial-balance": {
    title: "Trial balance",
    category: "Financial statements",
    zeroBalances: true,
  },
  "balance-sheet": {
    title: "Balance sheet",
    category: "Financial statements",
    asOf: true,
  },
  "profit-loss": { title: "Profit and loss", category: "Financial statements" },
  "comparative-profit-loss": {
    title: "Comparative profit and loss",
    category: "Financial statements",
  },
  "cash-movement": {
    title: "Cash and bank movement",
    category: "Cash and expenses",
  },
  daybook: { title: "Daybook / daily entries", category: "Books and ledgers" },
  journal: { title: "Journal register", category: "Books and ledgers" },
  "general-ledger": {
    title: "General ledger",
    category: "Books and ledgers",
    accounts: "all",
    zeroBalances: true,
  },
  "cash-book": {
    title: "Cash book",
    category: "Books and ledgers",
    accounts: "cash",
    zeroBalances: true,
  },
  "bank-book": {
    title: "Bank book",
    category: "Books and ledgers",
    accounts: "bank",
    zeroBalances: true,
  },
  "sales-register": {
    title: "Sales register",
    category: "Trading",
    parties: true,
  },
  "purchase-register": {
    title: "Purchase register",
    category: "Trading",
    parties: true,
  },
  "credit-notes": {
    title: "Credit notes / sales returns",
    category: "Trading",
    parties: true,
  },
  "debit-notes": {
    title: "Debit notes / purchase returns",
    category: "Trading",
    parties: true,
  },
  receipts: {
    title: "Receipt register",
    category: "Cash and expenses",
    parties: true,
  },
  payments: {
    title: "Payment register",
    category: "Cash and expenses",
    parties: true,
  },
  expenses: { title: "Expense summary", category: "Cash and expenses" },
  receivables: {
    title: "Receivables ageing",
    category: "Outstanding",
    asOf: true,
    parties: true,
  },
  payables: {
    title: "Payables ageing",
    category: "Outstanding",
    asOf: true,
    parties: true,
  },
  stock: {
    title: "Stock summary",
    category: "Inventory",
    asOf: true,
    zeroBalances: true,
  },
  "tax-ledgers": {
    title: "GST and TDS ledgers",
    category: "Tax",
    zeroBalances: true,
  },
  "profit-loss-t": {
    title: "Profit and loss (T format)",
    category: "Financial statements",
  },
  "balance-sheet-t": {
    title: "Balance sheet (T format)",
    category: "Financial statements",
    asOf: true,
  },
  "itc-at-risk": {
    title: "ITC at risk (unpaid 150+ days)",
    category: "Tax",
    asOf: true,
    parties: true,
  },
  "interest-calculator": {
    title: "Interest on overdue invoices",
    category: "Outstanding",
    asOf: true,
    parties: true,
  },
  "customer-tracking": {
    title: "Customer tracking",
    category: "Customers and suppliers",
    parties: true,
  },
  "top-customers": {
    title: "Most valuable customers",
    category: "Customers and suppliers",
  },
  "top-suppliers": {
    title: "Most valuable suppliers",
    category: "Customers and suppliers",
  },
  "sales-by-party": {
    title: "Sales by customer",
    category: "Trading",
    parties: true,
  },
  "sales-by-item": {
    title: "Sales by item",
    category: "Trading",
    parties: true,
  },
  "purchases-by-party": {
    title: "Purchases by supplier",
    category: "Trading",
    parties: true,
  },
  "purchases-by-item": {
    title: "Purchases by item",
    category: "Trading",
    parties: true,
  },
  "expenses-by-party": {
    title: "Expenses by supplier",
    category: "Cash and expenses",
  },
  "estimates-register": {
    title: "Estimates",
    category: "Orders",
    parties: true,
  },
  "proformas-register": {
    title: "Proforma invoices",
    category: "Orders",
    parties: true,
  },
  "sales-orders-register": {
    title: "Sales orders",
    category: "Orders",
    parties: true,
  },
  "delivery-notes-register": {
    title: "Delivery notes",
    category: "Orders",
    parties: true,
  },
  "purchase-orders-register": {
    title: "Purchase orders",
    category: "Orders",
    parties: true,
  },
  gstr2: { title: "GSTR-2 purchases", category: "Tax" },
  "tax-summary": { title: "GST summary by rate", category: "Tax" },
  "audit-trail": { title: "Audit trail (edit log)", category: "Audit" },
};

export interface ReportRequest {
  tax?: TaxScope;
  report: ReportId;
  from: ISODate;
  to: ISODate;
  accountKey?: string;
  partyId?: string;
  includeNarration: boolean;
  includeZeroBalances: boolean;
  /** Interest calculator: yearly rate in percent (default 18). */
  interestRate?: number;
}

export interface ReportColumn {
  label: string;
  kind: "text" | "money" | "number";
}
export interface ReportRow {
  cells: (string | number)[];
  total?: boolean;
}
export interface ReportSection {
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}
export interface ReportDocument {
  title: string;
  firmName: string;
  gstin: string;
  address: string;
  period: string;
  generatedAt: string;
  fileName: string;
  notes: string[];
  sections: ReportSection[];
}
export type ReportBooks = Books & {
  firm: Firm;
  /** Edit log for the audit trail report; the API loads it only for that report. */
  auditLog?: AuditEntry[];
  /** The reader may see each change's IP address and device. */
  auditOrigin?: boolean;
};

export const ENTRY_LABELS: Record<VoucherType, string> = {
  sale: "Sale",
  purchase: "Purchase",
  receipt: "Receipt",
  payment: "Payment",
  expense: "Expense",
  journal: "Journal",
  contra: "Contra",
  "credit-note": "Credit note",
  "debit-note": "Debit note",
  estimate: "Estimate",
  proforma: "Proforma invoice",
  "sales-order": "Sales order",
  "purchase-order": "Purchase order",
  "delivery-note": "Delivery note",
};

export class ReportInputError extends Error {}
