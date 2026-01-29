import { calcInvoice } from "../accounting/invoice";
import { formatDate } from "../dates";
import {
  appendTotals,
  moneyColumn,
  namedPostings,
  narrationCells,
  reportRow,
  reportVouchers,
  textColumn,
  voucherParty,
  withNarration,
} from "./helpers";
import {
  ENTRY_LABELS,
  REPORTS,
  type ReportBooks,
  type ReportRequest,
  type ReportSection,
} from "./types";

/** Daybook and journal list both sides of every entry; they do not double-count voucher amounts. */
export function daybookSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const vouchers = reportVouchers(books, request).filter(
    (v) => request.report !== "journal" || v.type === "journal",
  );
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: withNarration(
      [
        textColumn("Date"),
        textColumn("Voucher"),
        textColumn("Type"),
        textColumn("Account"),
        moneyColumn("Debit"),
        moneyColumn("Credit"),
      ],
      request,
    ),
    rows: vouchers.flatMap((v) =>
      namedPostings(books, v).map((p) =>
        reportRow(
          ...narrationCells(
            [
              formatDate(v.date),
              v.number,
              ENTRY_LABELS[v.type],
              p.ledger,
              p.debit,
              p.credit,
            ],
            v,
            request,
          ),
        ),
      ),
    ),
  });
}

/** Sales/purchase registers include credit/debit notes as negative amounts in their issue period. */
export function tradeRegister(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const types =
    request.report === "sales-register"
      ? ["sale", "credit-note"]
      : request.report === "purchase-register"
        ? ["purchase", "debit-note"]
        : request.report === "credit-notes"
          ? ["credit-note"]
          : ["debit-note"];
  const rows = reportVouchers(books, request)
    .filter((v) => types.includes(v.type))
    .map((v) => {
      const totals = calcInvoice({
        lines: v.lines ?? [],
        charges: v.charges,
        interState: !!v.interState,
      });
      const sign =
        types.length > 1 &&
        (v.type === "credit-note" || v.type === "debit-note")
          ? -1
          : 1;
      const party = voucherParty(books, v);
      const reference =
        v.supplierInvoiceNo ??
        books.vouchers.find((bill) => bill.id === v.againstId)?.number ??
        "";
      return reportRow(
        ...narrationCells(
          [
            formatDate(v.date),
            v.number,
            ENTRY_LABELS[v.type],
            reference,
            party?.name ?? "",
            party?.gstin ?? "",
            sign * totals.taxable,
            sign * totals.cgst,
            sign * totals.sgst,
            sign * totals.igst,
            sign * totals.roundOff,
            sign * v.amount,
          ],
          v,
          request,
        ),
      );
    });
  return appendTotals(
    {
      title: REPORTS[request.report].title,
      columns: withNarration(
        [
          textColumn("Date"),
          textColumn("Voucher"),
          textColumn("Type"),
          textColumn("Bill reference"),
          textColumn("Party"),
          textColumn("GSTIN"),
          moneyColumn("Value before tax"),
          moneyColumn("CGST"),
          moneyColumn("SGST"),
          moneyColumn("IGST"),
          moneyColumn("Round off"),
          moneyColumn("Total"),
        ],
        request,
      ),
      rows,
    },
    types.length > 1 ? "Net total" : "Total",
  );
}

/** Payments distinguish actual money paid from TDS withheld and the total party settlement. */
export function moneyRegister(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const type = request.report === "receipts" ? "receipt" : "payment";
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: withNarration(
      [
        textColumn("Date"),
        textColumn("Voucher"),
        textColumn("Party"),
        textColumn("Cash / bank"),
        textColumn("Mode"),
        moneyColumn("Money moved"),
        moneyColumn("TDS withheld"),
        moneyColumn("Party settlement"),
      ],
      request,
    ),
    rows: reportVouchers(books, request)
      .filter((v) => v.type === type)
      .map((v) =>
        reportRow(
          ...narrationCells(
            [
              formatDate(v.date),
              v.number,
              voucherParty(books, v)?.name ?? "",
              books.ledgers.find((l) => l.id === v.ledgerId)?.name ?? "",
              v.mode ?? "",
              v.amount,
              v.tds?.amount ?? 0,
              v.amount + (v.tds?.amount ?? 0),
            ],
            v,
            request,
          ),
        ),
      ),
  });
}
