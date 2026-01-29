import { acc } from "../accounting/accounts";
import { periodProfitAndLoss } from "../accounting/generalLedger";
import { addDays, daysBetween, formatDate } from "../dates";
import { ledgerIndex } from "./ledger";
import { moneyColumn, reportRow, textColumn } from "./helpers";
import {
  ENTRY_LABELS,
  type ReportBooks,
  type ReportRequest,
  type ReportSection,
} from "./types";

function profitFigures(books: ReportBooks, from: string, to: string) {
  const profit = periodProfitAndLoss(books, from, to);
  const sum = (rows: { amount: number }[]) =>
    rows.reduce((total, row) => total + row.amount, 0);
  return [
    ["Net sales", profit.sales],
    [
      "Cost of goods sold",
      profit.openingStock +
        profit.purchases +
        sum(profit.directExpenses) -
        profit.closingStock,
    ],
    ["Gross profit / (loss)", profit.grossProfit],
    ["Other income", sum(profit.indirectIncomes)],
    ["Indirect expenses", sum(profit.indirectExpenses)],
    ["Net profit / (loss)", profit.netProfit],
  ] as const;
}

/** Missing prior books are distinct from a real period with zero activity. */
export function comparativeProfitSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const days = daysBetween(request.from, request.to) + 1;
  const priorTo = addDays(request.from, -1);
  const priorFrom = addDays(request.from, -days);
  const previous =
    priorFrom >= books.firm.fyStart
      ? profitFigures(books, priorFrom, priorTo)
      : null;
  const current = profitFigures(books, request.from, request.to);
  return {
    title: `Previous period: ${formatDate(priorFrom)} to ${formatDate(priorTo)}`,
    columns: [
      textColumn("Particulars"),
      moneyColumn("Selected period"),
      moneyColumn("Previous period"),
      moneyColumn("Change"),
    ],
    rows: current.map(([label, amount], index) => ({
      cells: [
        label,
        amount,
        previous?.[index][1] ?? "Unavailable",
        previous ? amount - previous[index][1] : "Unavailable",
      ],
      total: index === current.length - 1,
    })),
  };
}

/** Net each voucher across all money ledgers so contra transfers cannot inflate flows. */
export function cashMovementSections(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection[] {
  const cashKeys = new Set(
    books.ledgers.map((ledger) => acc.ledger(ledger.id)),
  );
  const ledgers = ledgerIndex(books, request).filter((ledger) =>
    cashKeys.has(ledger.key),
  );
  const opening = ledgers.reduce((total, ledger) => total + ledger.opening, 0);
  const movements = new Map<string, { label: string; amount: number }>();
  for (const ledger of ledgers) {
    for (const row of ledger.movements) {
      const movement = movements.get(row.voucher.id) ?? {
        label: ENTRY_LABELS[row.voucher.type],
        amount: 0,
      };
      movement.amount += row.debit - row.credit;
      movements.set(row.voucher.id, movement);
    }
  }
  const groups = new Map<string, { received: number; paid: number }>();
  for (const { label, amount } of movements.values()) {
    if (!amount) continue;
    const group = groups.get(label) ?? { received: 0, paid: 0 };
    group.received += Math.max(amount, 0);
    group.paid += Math.max(-amount, 0);
    groups.set(label, group);
  }
  const totals = [...groups.values()].reduce(
    (sum, row) => ({
      received: sum.received + row.received,
      paid: sum.paid + row.paid,
    }),
    { received: 0, paid: 0 },
  );
  const net = totals.received - totals.paid;
  return [
    {
      title: "Cash and bank reconciliation",
      columns: [textColumn("Particulars"), moneyColumn("Amount")],
      rows: [
        reportRow("Opening balance", opening),
        reportRow("Money received", totals.received),
        reportRow("Money paid", totals.paid),
        reportRow("Net movement", net),
        { ...reportRow("Closing balance", opening + net), total: true },
      ],
    },
    {
      title: "External movements by entry type",
      columns: [
        textColumn("Entry type"),
        moneyColumn("Received"),
        moneyColumn("Paid"),
        moneyColumn("Net"),
      ],
      rows: [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, row]) =>
          reportRow(label, row.received, row.paid, row.received - row.paid),
        ),
    },
  ];
}
