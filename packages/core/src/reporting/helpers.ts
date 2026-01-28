import { describeAccount } from "../accounting/accounts";
import { isPosted } from "../accounting/bills";
import { voucherPostings } from "../accounting/postings";
import type { Voucher } from "../types";
import type {
  ReportBooks,
  ReportColumn,
  ReportRequest,
  ReportRow,
  ReportSection,
} from "./types";

export const textColumn = (label: string): ReportColumn => ({
  label,
  kind: "text",
});
export const moneyColumn = (label: string): ReportColumn => ({
  label,
  kind: "money",
});
export const numberColumn = (label: string): ReportColumn => ({
  label,
  kind: "number",
});
export const reportRow = (...cells: ReportRow["cells"]): ReportRow => ({
  cells,
});

/** Orders never enter the financial registers; only posted accounting entries do. */
export function reportVouchers(books: ReportBooks, request: ReportRequest) {
  return books.vouchers
    .filter(
      (v) =>
        isPosted(v) &&
        v.date >= request.from &&
        v.date <= request.to &&
        (!request.partyId || v.partyId === request.partyId) &&
        voucherPostings(v).length > 0,
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

export function voucherParty(books: ReportBooks, voucher: Voucher) {
  return (
    voucher.snapshot?.party ??
    books.parties.find((p) => p.id === voucher.partyId)
  );
}

/** Resolve current ledger names but keep each invoice's recorded party name. */
export function namedPostings(books: ReportBooks, voucher: Voucher) {
  return voucherPostings(voucher).map((p) => ({
    ...p,
    ledger:
      p.account === `party:${voucher.partyId}`
        ? (voucherParty(books, voucher)?.name ?? p.ledger)
        : describeAccount(p.account, books).name,
  }));
}

export function withNarration(columns: ReportColumn[], request: ReportRequest) {
  return request.includeNarration
    ? [...columns, textColumn("Narration")]
    : columns;
}

export function narrationCells(
  cells: ReportRow["cells"],
  voucher: Voucher,
  request: ReportRequest,
) {
  return request.includeNarration ? [...cells, voucher.narration ?? ""] : cells;
}

/** Only add monetary columns; quantities in different units must never be totalled. */
export function appendTotals(
  section: ReportSection,
  label = "Total",
): ReportSection {
  const totals = section.columns.map((column, index) =>
    column.kind === "money"
      ? section.rows.reduce(
          (sum, row) => sum + Number(row.cells[index] || 0),
          0,
        )
      : index === 0
        ? label
        : "",
  );
  return {
    ...section,
    rows: [...section.rows, { cells: totals, total: true }],
  };
}
