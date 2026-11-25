/**
 * Salesperson reports (doc 37, T10): sales and sales orders by salesperson,
 * from the same books snapshot as the other reports.
 */
import { isPosted } from "../accounting/bills";
import { calcInvoice } from "../accounting/invoice";
import { orderStatus } from "../accounting/orders";
import type { Voucher } from "../types";
import {
  appendTotals,
  moneyColumn,
  numberColumn,
  reportRow,
  textColumn,
} from "./helpers";
import {
  REPORTS,
  type ReportBooks,
  type ReportRequest,
  type ReportSection,
} from "./types";

const NO_SALESPERSON = "No salesperson";

function salespersonName(books: ReportBooks, id: string | undefined) {
  if (!id) return NO_SALESPERSON;
  return books.salespersons?.find((s) => s.id === id)?.name ?? "Removed";
}

/** A return counts against the salesperson of the bill it returns. */
function salespersonOf(books: ReportBooks, v: Voucher) {
  if (v.type === "credit-note" && v.againstId)
    return books.vouchers.find((b) => b.id === v.againstId)?.salespersonId;
  return v.salespersonId;
}

const inPeriod = (v: Voucher, request: ReportRequest) =>
  v.date >= request.from &&
  v.date <= request.to &&
  (!request.partyId || v.partyId === request.partyId);

/** Sales by salesperson: bills, returns netted, taxable value, GST and total. */
export function salesBySalespersonSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const rows = new Map<
    string,
    {
      name: string;
      bills: number;
      returns: number;
      taxable: number;
      tax: number;
      total: number;
    }
  >();
  for (const v of books.vouchers) {
    if (
      !isPosted(v) ||
      (v.type !== "sale" && v.type !== "credit-note") ||
      !inPeriod(v, request)
    )
      continue;
    const id = salespersonOf(books, v) ?? "";
    const row = rows.get(id) ?? {
      name: salespersonName(books, id || undefined),
      bills: 0,
      returns: 0,
      taxable: 0,
      tax: 0,
      total: 0,
    };
    const t = calcInvoice({
      lines: v.lines ?? [],
      charges: v.charges,
      interState: !!v.interState,
    });
    const sign = v.type === "credit-note" ? -1 : 1;
    if (sign > 0) row.bills += 1;
    else row.returns += 1;
    row.taxable += sign * t.taxable;
    row.tax += sign * t.tax;
    row.total += sign * v.amount;
    rows.set(id, row);
  }
  return appendTotals({
    title: REPORTS["sales-by-salesperson"].title,
    columns: [
      textColumn("Salesperson"),
      numberColumn("Bills"),
      numberColumn("Returns"),
      moneyColumn("Taxable value"),
      moneyColumn("GST"),
      moneyColumn("Net sales"),
    ],
    rows: [...rows.values()]
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .map((r) =>
        reportRow(r.name, r.bills, r.returns, r.taxable, r.tax, r.total),
      ),
  });
}

/** Sales orders by salesperson: how many, how many still open, and their value. */
export function salesOrdersBySalespersonSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const rows = new Map<
    string,
    {
      name: string;
      orders: number;
      open: number;
      amount: number;
      openAmount: number;
    }
  >();
  for (const v of books.vouchers) {
    if (
      v.type !== "sales-order" ||
      v.status === "draft" ||
      v.status === "cancelled" ||
      !inPeriod(v, request)
    )
      continue;
    const id = v.salespersonId ?? "";
    const row = rows.get(id) ?? {
      name: salespersonName(books, id || undefined),
      orders: 0,
      open: 0,
      amount: 0,
      openAmount: 0,
    };
    const status = orderStatus(v, request.to);
    row.orders += 1;
    row.amount += v.amount;
    if (status === "open" || status === "partial") {
      row.open += 1;
      row.openAmount += v.amount;
    }
    rows.set(id, row);
  }
  return appendTotals({
    title: REPORTS["sales-orders-by-salesperson"].title,
    columns: [
      textColumn("Salesperson"),
      numberColumn("Orders"),
      numberColumn("Open"),
      moneyColumn("Order value"),
      moneyColumn("Open order value"),
    ],
    rows: [...rows.values()]
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      .map((r) => reportRow(r.name, r.orders, r.open, r.amount, r.openAmount)),
  });
}
