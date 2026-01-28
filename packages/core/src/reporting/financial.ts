import {
  finalAccounts,
  periodProfitAndLoss,
} from "../accounting/generalLedger";
import { moneyColumn, reportRow, textColumn } from "./helpers";
import type { ReportBooks, ReportRequest, ReportSection } from "./types";

/** Subtract pre-period balances so P&L contains only the selected period's activity. */
export function profitLossSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const pl = periodProfitAndLoss(books, request.from, request.to);
  const details = (rows: { name: string; amount: number }[]) =>
    rows.map((a) => reportRow(a.name, a.amount));
  return {
    title: "Profit and loss",
    columns: [textColumn("Particulars"), moneyColumn("Amount")],
    rows: [
      reportRow("Net sales (after returns)", pl.sales),
      reportRow("Opening stock", pl.openingStock),
      reportRow("Net purchases (after returns)", pl.purchases),
      ...details(pl.directExpenses),
      reportRow("Closing stock", pl.closingStock),
      { ...reportRow("Gross profit / (loss)", pl.grossProfit), total: true },
      ...details(pl.indirectIncomes),
      ...details(pl.indirectExpenses),
      { ...reportRow("Net profit / (loss)", pl.netProfit), total: true },
    ],
  };
}

/** The balance sheet is cumulative through the closing date, not a date-range movement report. */
export function balanceSheetSections(
  books: ReportBooks,
  request: ReportRequest,
) {
  const sheet = finalAccounts(books, request.to).balanceSheet;
  const sections: ReportSection[] = (["liabilities", "assets"] as const).map(
    (side) => ({
      title: side === "assets" ? "Assets" : "Capital and liabilities",
      columns: [
        textColumn("Group"),
        textColumn("Account"),
        moneyColumn("Amount"),
      ],
      rows: [
        ...sheet[side].sections.flatMap((s) =>
          s.lines.map((l) => reportRow(s.title, l.name, l.amount)),
        ),
        { ...reportRow("Total", "", sheet[side].total), total: true },
      ],
    }),
  );
  return { sections, balanced: sheet.balanced };
}
