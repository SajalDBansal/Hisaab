import type { Firm, ReportDocument } from "@repo/core";
import type {
  AssociateRecord,
  AssociateStatement,
  AssociateStatementQuery,
} from "@repo/contracts/src/associates";

export function associateStatementReport(
  firm: Firm,
  associate: AssociateRecord,
  statement: AssociateStatement,
  query: AssociateStatementQuery,
): ReportDocument {
  return {
    title: `Commission statement - ${associate.name}`,
    firmName: firm.name,
    gstin: firm.gstin ?? "",
    address: firm.city,
    period: `${query.from ?? "Opening"} to ${query.to ?? "Current"} | ${query.scope === "all" ? "Mixed" : query.scope}`,
    generatedAt: new Date().toISOString(),
    fileName: `commission-${associate.id}`,
    notes: [],
    sections: [
      {
        title: "Summary",
        columns: [
          { label: "Description", kind: "text" },
          { label: "Amount", kind: "money" },
        ],
        rows: [
          { cells: ["Opening due", statement.opening] },
          { cells: ["Earned", statement.earned] },
          { cells: ["Adjustments", statement.adjusted] },
          { cells: ["Paid, net of reversals", statement.paid] },
          { cells: ["Closing due", statement.closing], total: true },
          { cells: ["Payable ledger", statement.ledgerBalance] },
          { cells: ["Difference", statement.difference] },
        ],
      },
      {
        title: "Entries",
        columns: [
          { label: "Date", kind: "text" },
          { label: "Description", kind: "text" },
          { label: "Book", kind: "text" },
          { label: "Amount", kind: "money" },
        ],
        rows: statement.rows.map((row) => ({
          cells: [row.date, row.description, row.bookScope, row.amount],
        })),
      },
      {
        title: query.unpaidOnly === "true" ? "Unsettled sales" : "Sales",
        columns: [
          { label: "Sale", kind: "text" },
          { label: "Line", kind: "number" },
          { label: "Basis", kind: "money" },
          { label: "Earned", kind: "money" },
          { label: "Balance", kind: "money" },
        ],
        rows: statement.accruals.map((row) => ({
          cells: [
            row.saleId,
            row.lineIndex + 1,
            row.basis,
            row.earned,
            row.balance,
          ],
        })),
      },
    ],
  };
}
