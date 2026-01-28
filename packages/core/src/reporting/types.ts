import type { Firm, ISODate, VoucherType, TaxScope } from "../types";
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
export type ReportBooks = Books & { firm: Firm };

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
  "sales-order": "Sales order",
  "purchase-order": "Purchase order",
  "delivery-note": "Delivery note",
};

export class ReportInputError extends Error {}
