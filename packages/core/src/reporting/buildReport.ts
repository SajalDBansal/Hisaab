import { formatDate } from "../dates";
import { scopeBooks } from "../accounting/bookScope";
import { balanceSheetSections, profitLossSection } from "./financial";
import { cashMovementSections, comparativeProfitSection } from "./management";
import { ledgerSections, trialBalanceSection } from "./ledger";
import { daybookSection, moneyRegister, tradeRegister } from "./registers";
import { expenseSection, outstandingSection, stockSection } from "./summaries";
import {
  REPORTS,
  ReportInputError,
  type ReportBooks,
  type ReportDocument,
  type ReportRequest,
  type ReportSection,
} from "./types";

function validateRequest(books: ReportBooks, request: ReportRequest) {
  if (!REPORTS[request.report]) throw new ReportInputError("Choose a report.");
  const validDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (
    !validDate(request.from) ||
    !validDate(request.to) ||
    request.from > request.to
  )
    throw new ReportInputError("Choose a valid start and end date.");
  if (request.from < books.firm.fyStart)
    throw new ReportInputError(
      `These books begin on ${formatDate(books.firm.fyStart)}.`,
    );
  const definition = REPORTS[request.report];
  if (request.accountKey && !definition.accounts)
    throw new ReportInputError("This report cannot be filtered by account.");
  if (
    request.partyId &&
    (!definition.parties ||
      !books.parties.some((p) => p.id === request.partyId))
  )
    throw new ReportInputError(
      "Choose a party belonging to this firm and report.",
    );
}

function buildSections(
  books: ReportBooks,
  request: ReportRequest,
  sourceBooks: ReportBooks,
): ReportSection[] {
  switch (request.report) {
    case "trial-balance":
    case "tax-ledgers":
      return [trialBalanceSection(books, request)];
    case "balance-sheet":
      return balanceSheetSections(books, request).sections;
    case "profit-loss":
      return [profitLossSection(books, request)];
    case "comparative-profit-loss":
      return [comparativeProfitSection(books, request)];
    case "cash-movement":
      return cashMovementSections(books, request);
    case "general-ledger":
    case "cash-book":
    case "bank-book":
      return ledgerSections(books, request, sourceBooks);
    case "daybook":
    case "journal":
      return [daybookSection(books, request)];
    case "sales-register":
    case "purchase-register":
    case "credit-notes":
    case "debit-notes":
      return [tradeRegister(books, request)];
    case "receipts":
    case "payments":
      return [moneyRegister(books, request)];
    case "expenses":
      return [expenseSection(books, request)];
    case "receivables":
    case "payables":
      return [outstandingSection(books, request)];
    case "stock":
      return [stockSection(books, request)];
  }
}

/** Build one authoritative report document for PDF, CSV and preview from the same books. */
export function buildReport(
  books: ReportBooks,
  request: ReportRequest,
): ReportDocument {
  validateRequest(books, request);
  const sourceBooks = books;
  books = scopeBooks(books, request.tax);
  const definition = REPORTS[request.report];
  const sections = buildSections(books, request, sourceBooks);
  if (sections.reduce((n, s) => n + s.rows.length, 0) > 20_000)
    throw new ReportInputError(
      "This report is too large. Choose a shorter period or a single account.",
    );
  const notes = [
    "Amounts in INR. Only posted entries are included; drafts, cancelled entries and orders are excluded from financial totals.",
  ];
  if (
    [
      "stock",
      "profit-loss",
      "comparative-profit-loss",
      "balance-sheet",
    ].includes(request.report)
  )
    notes.push(
      "Stock uses purchase-lot cost after discounts. Freight remains a period expense. Legacy unassigned movements use FIFO; opening costs use the saved migration baseline.",
    );
  if (request.report === "comparative-profit-loss")
    notes.push(
      "Compares the selected period with the immediately preceding period of the same number of days. Prior periods before the books began are unavailable, not zero.",
    );
  if (request.report === "cash-movement")
    notes.push(
      "Management summary of posted cash and bank movements, not a statutory cash-flow statement or forecast. Internal transfers are excluded. Posting dates, not bank-clearing dates, determine the period.",
    );
  if (request.report === "tax-ledgers")
    notes.push(
      "Book balances only. Not a GST return, ITC eligibility check or filing document.",
    );
  if (["receivables", "payables"].includes(request.report))
    notes.push(
      "Ageing is based on outstanding bills at the closing date; advances are netted against the party balance.",
    );
  if (
    request.report === "balance-sheet" &&
    !balanceSheetSections(books, request).balanced
  )
    notes.push(
      "WARNING: Assets and liabilities do not balance. Review the books before relying on this statement.",
    );
  if (request.report === "trial-balance") {
    const totals = sections[0].rows.slice(-1)[0].cells;
    if (totals[5] !== totals[6])
      notes.push(
        "WARNING: Trial balance does not balance. Review the postings.",
      );
  }
  if (request.partyId)
    notes.push(
      `Party: ${books.parties.find((p) => p.id === request.partyId)!.name}`,
    );
  const period = definition.asOf
    ? `As at ${formatDate(request.to)}`
    : `${formatDate(request.from)} to ${formatDate(request.to)}`;
  const firmSlug =
    books.firm.name
      .replace(/[^A-Za-z0-9-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || "Firm";
  return {
    title: `${definition.title} (${request.tax === "gst" ? "GST" : request.tax === "nongst" ? "Non-GST" : "Mixed"})`,
    firmName: books.firm.name,
    gstin: books.firm.gstin,
    address: [books.firm.address, books.firm.city, books.firm.state]
      .filter(Boolean)
      .join(", "),
    period,
    generatedAt: new Date().toISOString(),
    notes,
    sections,
    fileName: `${firmSlug}_${request.report}_${request.tax ?? "all"}_${definition.asOf ? request.to : `${request.from}_${request.to}`}`,
  };
}
