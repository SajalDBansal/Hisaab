import {
  expenseSummary,
  outstanding,
  stockSummary,
} from "../accounting/analysis";
import { stockVouchersAsOf } from "../accounting/stock";
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

export function expenseSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const summary = expenseSummary(
    books.vouchers,
    request.from,
    request.to,
    books.accounts,
  );
  return appendTotals({
    title: "Expenses",
    columns: [
      textColumn("Expense head"),
      numberColumn("Postings"),
      moneyColumn("Net expense"),
    ],
    rows: summary.heads.map((h) => reportRow(h.head, h.entries, h.total)),
  });
}

/** Filter receipts and allocations at the cutoff before computing historical ageing. */
export function outstandingSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const type = request.report === "receivables" ? "customer" : "supplier";
  const parties = books.parties.filter(
    (p) => !request.partyId || p.id === request.partyId,
  );
  const vouchers = books.vouchers.filter((v) => v.date <= request.to);
  const summary = outstanding(type, parties, vouchers, request.to);
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: [
      textColumn("Party"),
      moneyColumn("Outstanding"),
      moneyColumn("Overdue"),
      moneyColumn("0-30 days"),
      moneyColumn("31-60 days"),
      moneyColumn("61-90 days"),
      moneyColumn("90+ days"),
      moneyColumn("On account"),
      numberColumn("Max overdue days"),
    ],
    rows: summary.rows.map((p) =>
      reportRow(
        p.name,
        p.amount,
        p.overdue,
        p.ageing["0-30"],
        p.ageing["31-60"],
        p.ageing["61-90"],
        p.ageing["90+"],
        p.onAccount,
        p.maxOverdueDays,
      ),
    ),
  });
}

export function stockSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const summary = stockSummary(
    books.items,
    stockVouchersAsOf(books.vouchers, request.to),
  );
  return appendTotals({
    title: "Closing stock",
    columns: [
      textColumn("Group"),
      textColumn("Item"),
      numberColumn("Quantity"),
      textColumn("Unit"),
      moneyColumn("Value"),
    ],
    rows: summary.groups.flatMap((g) =>
      g.items
        .filter((i) => request.includeZeroBalances || i.qty !== 0)
        .map((i) => reportRow(g.group, i.name, i.qty, i.unit, i.value)),
    ),
  });
}
