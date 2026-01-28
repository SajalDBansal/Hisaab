import { calcInvoice, type InvoiceTotals } from "../accounting/invoice";
import {
  postingTotals,
  voucherPostings,
  type Posting,
} from "../accounting/postings";
import {
  invoiceStatus,
  settledAmounts,
  type InvoiceStatus,
} from "../accounting/bills";
import { newestFirst } from "../accounting/reports";
import { addDays, financialYear, today } from "../dates";
import {
  CONVERTS_TO,
  isOrderType,
  orderStatus,
  type OrderStatus,
} from "../accounting/orders";
import { checkVoucherDate } from "../validation";
import {
  createExpense,
  createJournal,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
  createSales,
  cancelBlocker,
  cancelVoucher,
  createNote,
  createContra,
  createOrder,
  convertBlocker,
  editBlocker,
  peekNumber,
  returnableLines,
  updateInvoice,
  type Series,
} from "../mock/db";
import type {
  AuditEntry,
  Item,
  NewExpenseInput,
  NewInvoiceInput,
  NewJournalInput,
  NewNoteInput,
  NewContraInput,
  NewOrderInput,
  OrderType,
  NewMoneyInput,
  Paise,
  Party,
  Voucher,
  VoucherType,
} from "../types";
import { clone, delay, getDb } from "./client";

export interface VoucherFilters {
  type?: VoucherType;
  /** Several types at once, e.g. ["receipt", "payment", "expense"] for Banking. */
  types?: VoucherType[];
  partyId?: string;
  /** Max number of vouchers to return. */
  limit?: number;
}

export interface VoucherDetail {
  voucher: Voucher;
  party?: Party;
  /** Item records used on the invoice lines. */
  items: Item[];
  ledgerName?: string;
  totals?: InvoiceTotals;
  postings: Posting[];
  postingTotals: ReturnType<typeof postingTotals>;
  /** For invoices: money received/paid against it so far. */
  settled: number;
  /** Receipts/payments that settled this invoice. */
  payments: Voucher[];
  /** For receipts/payments: which bills the money was applied to. */
  allocatedTo: { voucherId: string; number: string; amount: number }[];
  /** Credit/debit notes: the bill the goods were returned against. */
  against?: { id: string; number: string };
  /** Sale/purchase: returns made against this bill. */
  returns: Voucher[];
  /** Why it can't be cancelled / edited right now (null = allowed). */
  cancelBlocker: string | null;
  editBlocker: string | null;
  /** Contra: where the money went. */
  toLedgerName?: string;
  /** Estimates / orders: what it can be turned into now (empty once converted or cancelled). */
  canConvertTo: ("sale" | "purchase" | OrderType)[];
  /** The document this was made from, and what this document was turned into. */
  source?: { id: string; number: string; type: string };
  convertedTo?: { id: string; number: string; type: string };
  /** Edit history of this voucher, oldest first. */
  history: AuditEntry[];
}

/** One row in the Estimates & orders list. */
export interface OrderRow {
  voucher: Voucher;
  partyName: string;
  status: OrderStatus;
  convertedTo?: { id: string; number: string };
}

/**
 * Dates allowed for new entries: up to today, back to the start of last financial year
 * (so last year's bills can still be finished in April).
 */
function assertDate(date: string) {
  const now = today();
  const lastFyStart = financialYear(
    addDays(financialYear(now).start, -1),
  ).start;
  const problem = checkVoucherDate(date, now, lastFyStart);
  if (problem) throw new Error(problem);
}

/** First and last date the date picker should allow. */
export function allowedDates() {
  const now = today();
  return {
    min: financialYear(addDays(financialYear(now).start, -1)).start,
    max: now,
  };
}

/** A bill's lines for the return form: what was billed and what is left to return. */
export interface ReturnableBill {
  bill: Voucher;
  partyName: string;
  lines: {
    index: number;
    itemName: string;
    /** Unit the line was billed in, e.g. "Box" or "Nos". */
    unit: string;
    qty: number;
    returned: number;
    returnable: number;
    rate: Paise;
  }[];
}

/** One row in the Sales or Purchase list. */
export interface InvoiceRow {
  voucher: Voucher;
  partyName: string;
  settled: Paise;
  pending: Paise;
  status: InvoiceStatus;
}

export const voucherService = {
  /** Sales or purchase invoices with payment status. Real API: http.get<InvoiceRow[]>(`/vouchers/invoices?type=${type}`) */
  async listInvoices(type: "sale" | "purchase"): Promise<InvoiceRow[]> {
    await delay();
    const { vouchers, parties } = getDb();
    const settled = settledAmounts(vouchers);
    const asOf = today();
    const rows = newestFirst(vouchers.filter((v) => v.type === type)).map(
      (v) => {
        const paid = settled.get(v.id) ?? 0;
        return {
          voucher: v,
          partyName: parties.find((p) => p.id === v.partyId)?.name ?? "",
          settled: paid,
          pending: v.status === "posted" ? Math.max(v.amount - paid, 0) : 0,
          status: invoiceStatus(v, paid, asOf),
        };
      },
    );
    return clone(rows);
  },

  /** Day Book list, newest first. Real API: http.get<Voucher[]>(`/vouchers?type=…&partyId=…`) */
  async list(filters: VoucherFilters = {}): Promise<Voucher[]> {
    await delay();
    const list = newestFirst(
      getDb().vouchers.filter(
        (v) =>
          (!filters.type || v.type === filters.type) &&
          (!filters.types || filters.types.includes(v.type)) &&
          (!filters.partyId || v.partyId === filters.partyId),
      ),
    );
    return clone(filters.limit ? list.slice(0, filters.limit) : list);
  },

  /** Real API: http.get<VoucherDetail>(`/vouchers/${id}`) */
  async get(id: string): Promise<VoucherDetail> {
    await delay();
    const db = getDb();
    const voucher = db.vouchers.find((v) => v.id === id);
    if (!voucher) throw new Error("Voucher not found");
    const party = voucher.snapshot
      ? voucher.snapshot.party
      : db.parties.find((p) => p.id === voucher.partyId);
    const ledger = db.ledgers.find((l) => l.id === voucher.ledgerId);
    // Bills and returns both have item lines and totals
    const isInvoice =
      voucher.type === "sale" ||
      voucher.type === "purchase" ||
      voucher.type === "credit-note" ||
      voucher.type === "debit-note" ||
      isOrderType(voucher.type);
    const totals = isInvoice
      ? calcInvoice({
          lines: voucher.lines ?? [],
          charges: voucher.charges,
          interState: !!voucher.interState,
        })
      : undefined;
    const toLedger = db.ledgers.find((l) => l.id === voucher.toLedgerId);
    const postings = voucherPostings(voucher, {
      party: party?.name,
      ledger: ledger?.name,
      toLedger: toLedger?.name,
    });
    const payments = db.vouchers.filter(
      (v) =>
        v.status === "posted" && v.allocations?.some((a) => a.voucherId === id),
    );
    const settled = payments.reduce(
      (s, v) =>
        s +
        (v.allocations ?? [])
          .filter((a) => a.voucherId === id)
          .reduce((x, a) => x + a.amount, 0),
      0,
    );
    const allocatedTo = (voucher.allocations ?? []).map((a) => ({
      voucherId: a.voucherId,
      number:
        db.vouchers.find((v) => v.id === a.voucherId)?.number ??
        "Opening balance",
      amount: a.amount,
    }));
    const itemIds = new Set((voucher.lines ?? []).map((l) => l.itemId));
    const againstBill = db.vouchers.find((v) => v.id === voucher.againstId);
    return clone({
      against: againstBill
        ? { id: againstBill.id, number: againstBill.number }
        : undefined,
      returns: db.vouchers.filter(
        (v) => v.againstId === id && v.status === "posted",
      ),
      cancelBlocker: cancelBlocker(db, voucher),
      toLedgerName: toLedger?.name,
      canConvertTo: isOrderType(voucher.type)
        ? CONVERTS_TO[voucher.type].filter(
            (t) => !convertBlocker(db, voucher, t),
          )
        : [],
      source: (() => {
        const src = db.vouchers.find((v) => v.id === voucher.sourceId);
        return src
          ? { id: src.id, number: src.number, type: src.type }
          : undefined;
      })(),
      convertedTo: (() => {
        const to = db.vouchers.find((v) => v.id === voucher.convertedToId);
        return to ? { id: to.id, number: to.number, type: to.type } : undefined;
      })(),
      editBlocker: editBlocker(db, voucher),
      history: db.auditLog.filter((e) => e.voucherId === id),
      voucher,
      party,
      items: (voucher.snapshot?.items ?? db.items).filter((i) =>
        itemIds.has(i.id),
      ),
      ledgerName: ledger?.name,
      totals,
      postings,
      postingTotals: postingTotals(postings),
      settled,
      payments,
      allocatedTo,
    });
  },

  /** Number the next voucher will get. Real API: http.get<string>(`/vouchers/next-number?type=${type}&series=${series ?? ""}`) */
  async nextNumber(
    type: VoucherType,
    series?: Series,
    /** The number depends on the financial year of this date. */
    date: string = today(),
  ): Promise<string> {
    await delay();
    return peekNumber(getDb(), type, date, series);
  },

  /** Real API: http.post<Voucher>("/vouchers/sales", input) */
  async createSale(input: NewInvoiceInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createSale(getDb(), input));
  },
  async createSales(input: NewInvoiceInput): Promise<Voucher[]> {
    await delay();
    return clone(createSales(getDb(), input));
  },

  /** Real API: http.post<Voucher>("/vouchers/purchases", input) */
  async createPurchase(input: NewInvoiceInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createPurchase(getDb(), input));
  },

  /** Real API: http.post<Voucher>("/vouchers/receipts", input) */
  async createReceipt(input: NewMoneyInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createReceipt(getDb(), input));
  },

  /** Real API: http.post<Voucher>("/vouchers/payments", input) */
  async createPayment(input: NewMoneyInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createPayment(getDb(), input));
  },

  /** Real API: http.post<Voucher>("/vouchers/expenses", input) */
  async createExpense(input: NewExpenseInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createExpense(getDb(), input));
  },

  /** Real API: http.post<Voucher>("/vouchers/journals", input) */
  async createJournal(input: NewJournalInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createJournal(getDb(), input));
  },

  /** Cancel with a reason. Real API: http.post<Voucher>(`/vouchers/${id}/cancel`, { reason }) */
  async cancel(id: string, reason: string): Promise<Voucher> {
    await delay();
    return clone(cancelVoucher(getDb(), id, reason, new Date().toISOString()));
  },

  /** Edit a saved sale or purchase. Real API: http.put<Voucher>(`/vouchers/${id}`, input) */
  async updateInvoice(id: string, input: NewInvoiceInput): Promise<Voucher> {
    await delay();
    return clone(updateInvoice(getDb(), id, input, new Date().toISOString()));
  },

  /** Real API: http.get<ReturnableBill>(`/vouchers/${billId}/returnable`) */
  async returnable(billId: string): Promise<ReturnableBill> {
    await delay();
    const db = getDb();
    const rows = returnableLines(db, billId);
    const bill = db.vouchers.find((v) => v.id === billId)!;
    return clone({
      bill,
      partyName: db.parties.find((p) => p.id === bill.partyId)?.name ?? "",
      lines: rows.map((r) => {
        const item = db.items.find((i) => i.id === r.line.itemId);
        return {
          index: r.index,
          itemName: item?.name ?? "Item",
          unit: r.line.per?.unit ?? item?.unit ?? "",
          qty: r.line.qty,
          returned: r.returned,
          returnable: r.returnable,
          rate: r.line.rate,
        };
      }),
    });
  },

  /** Sales return. Real API: http.post<Voucher>("/vouchers/credit-notes", input) */
  async createCreditNote(input: NewNoteInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createNote(getDb(), "credit-note", input));
  },

  /** Purchase return. Real API: http.post<Voucher>("/vouchers/debit-notes", input) */
  async createDebitNote(input: NewNoteInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createNote(getDb(), "debit-note", input));
  },

  /** Cash ↔ bank transfer. Real API: http.post<Voucher>("/vouchers/contras", input) */
  async createContra(input: NewContraInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createContra(getDb(), input));
  },

  /** Estimate, sales order, delivery note or purchase order. Real API: http.post<Voucher>(`/vouchers/${type}s`, input) */
  async createOrder(type: OrderType, input: NewOrderInput): Promise<Voucher> {
    await delay();
    assertDate(input.date);
    return clone(createOrder(getDb(), type, input));
  },

  /** Real API: http.get<OrderRow[]>(`/vouchers/orders?type=${type}`) */
  async listOrders(type: OrderType): Promise<OrderRow[]> {
    await delay();
    const { vouchers, parties } = getDb();
    const now = today();
    return clone(
      newestFirst(vouchers.filter((v) => v.type === type)).map((v) => {
        const to = vouchers.find((x) => x.id === v.convertedToId);
        return {
          voucher: v,
          partyName: parties.find((p) => p.id === v.partyId)?.name ?? "",
          status: orderStatus(v, now),
          convertedTo: to ? { id: to.id, number: to.number } : undefined,
        };
      }),
    );
  },
};
