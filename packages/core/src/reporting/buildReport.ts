import { formatDate } from "../dates";
import { auditTrailSection } from "./audit";
import { scopeBooks } from "../accounting/bookScope";
import { balanceSheetSections, profitLossSection } from "./financial";
import { cashMovementSections, comparativeProfitSection } from "./management";
import { ledgerSections, trialBalanceSection } from "./ledger";
import { daybookSection, moneyRegister, tradeRegister } from "./registers";
import { expenseSection, outstandingSection, stockSection } from "./summaries";
import {
  ITC_REVERSE_DAYS,
  ITC_WARN_DAYS,
  LOST_CUSTOMER_DAYS,
  customerTrackingSection,
  expensesByPartySection,
  gstr2Sections,
  interestSection,
  itcAtRiskSection,
  msmePayablesSection,
  orderRegisterSection,
  taxSummarySection,
  tFormatBalanceSheetSection,
  tFormatProfitLossSections,
  topPartiesSection,
  tradeByItemSection,
  tradeByPartySection,
} from "./insights";
import { MSME_MAX_DAYS, MSME_NO_AGREEMENT_DAYS } from "../accounting/msme";
import { expiringItemsSection, stockLevelsSection } from "./stockLevels";
import {
  REPORTS,
  ReportInputError,
  type ReportBooks,
  type ReportDocument,
  type ReportRequest,
  type ReportSection,
} from "./types";

/** Reports that take a yearly interest rate. */
const RATE_REPORTS: string[] = ["interest-calculator", "msme-payables"];

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
  if (request.interestRate !== undefined) {
    if (!RATE_REPORTS.includes(request.report))
      throw new ReportInputError(
        "Only the interest calculator and MSME payables take a rate.",
      );
    if (
      !Number.isFinite(request.interestRate) ||
      request.interestRate < 0 ||
      request.interestRate > 60
    )
      throw new ReportInputError("Use an interest rate from 0 to 60% a year.");
  }
  if (request.expiryDays !== undefined) {
    if (request.report !== "expiring-items")
      throw new ReportInputError("Only the expiring items report takes days.");
    if (
      !Number.isInteger(request.expiryDays) ||
      request.expiryDays < 0 ||
      request.expiryDays > 365
    )
      throw new ReportInputError("Use 0 to 365 days ahead.");
  }
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
    case "profit-loss-t":
      return tFormatProfitLossSections(books, request);
    case "balance-sheet-t":
      return [tFormatBalanceSheetSection(books, request)];
    case "itc-at-risk":
      return [itcAtRiskSection(books, request)];
    case "interest-calculator":
      return [interestSection(books, request)];
    case "msme-payables":
      return [msmePayablesSection(books, request)];
    case "customer-tracking":
      return [customerTrackingSection(books, request)];
    case "top-customers":
    case "top-suppliers":
      return [topPartiesSection(books, request)];
    case "sales-by-party":
    case "purchases-by-party":
      return [tradeByPartySection(books, request)];
    case "sales-by-item":
    case "purchases-by-item":
      return [tradeByItemSection(books, request)];
    case "expenses-by-party":
      return [expensesByPartySection(books, request)];
    case "estimates-register":
    case "proformas-register":
    case "sales-orders-register":
    case "delivery-notes-register":
    case "purchase-orders-register":
      return [orderRegisterSection(books, request)];
    case "gstr2":
      return gstr2Sections(books, request);
    case "tax-summary":
      return [taxSummarySection(books, request)];
    case "audit-trail":
      return [auditTrailSection(books, request)];
    case "stock-levels":
      return [stockLevelsSection(books, request)];
    case "expiring-items":
      return [expiringItemsSection(books, request)];
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
  if (request.report === "itc-at-risk")
    notes.push(
      `Input GST on a supplier bill must be reversed if the bill is not paid within ${ITC_REVERSE_DAYS} days of its date (CGST Act s.16(2)); it can be claimed again once paid. ITC at risk is the bill's GST in proportion to what is still unpaid, as of the report date. Bills from ${ITC_WARN_DAYS} days are shown so they can be paid in time.`,
    );
  if (request.report === "stock-levels")
    notes.push(
      "Minimum is the item's reorder level. To order fills up to the maximum when one is set, otherwise back to the minimum. Services are not listed.",
    );
  if (request.report === "expiring-items")
    notes.push(
      "Stock lots still in hand with an expiry date from the purchase line (or the item's opening batch), valued at FIFO cost. Sales take the oldest purchase first, not the earliest expiry.",
    );
  if (request.report === "interest-calculator")
    notes.push(
      "Simple interest on the balance still due, from each invoice's due date to the report date. This is a working figure; it is not posted to the books.",
    );
  if (request.report === "msme-payables")
    notes.push(
      `Micro and small suppliers must be paid by the agreed date, at most ${MSME_MAX_DAYS} days from accepting the goods or services, or within ${MSME_NO_AGREEMENT_DAYS} days when no credit period was agreed (MSMED Act s.15). The bill date is taken as the acceptance date and the bill's due date as the agreed date. Medium enterprises are not covered and are not listed.`,
      "Interest (s.16): compound interest with monthly rests at three times the bank rate notified by the RBI, from the day after the pay-by date to the report date. The default rate assumes the 5.75% bank rate in force from 7 Oct 2026; check the RBI's current bank rate and set the rate on the report. Worked out on what is still unpaid; it is a working figure, not posted to the books.",
      "Income Tax s.43B(h): an amount due to a micro or small enterprise that is not paid within this time limit is allowed as an expense only in the year it is actually paid. Bills still overdue at the year end are added back to income for that year.",
    );
  if (request.report === "customer-tracking")
    notes.push(
      `New: first sale in the period. Lost: no sale in the ${LOST_CUSTOMER_DAYS} days before the report's end. Net sales take off returns in the period.`,
    );
  if (["gstr2", "tax-summary"].includes(request.report))
    notes.push(
      "Book workings from posted entries, including GST on paid expenses; returns are netted off. Not a filed return.",
    );
  if (request.report === "comparative-profit-loss")
    notes.push(
      "Compares the selected period with the immediately preceding period of the same number of days. Prior periods before the books began are unavailable, not zero.",
    );
  if (request.report === "cash-movement")
    notes.push(
      "Management summary of posted cash and bank movements, not a statutory cash-flow statement or forecast. Internal transfers are excluded. Posting dates, not bank-clearing dates, determine the period.",
    );
  if (request.report === "audit-trail")
    notes.push(
      books.auditOrigin
        ? "Every entry created, edited, cancelled, converted or restored in the period (Indian time). The log can't be switched off or changed. Amount now is the entry's current total."
        : "Every entry created, edited, cancelled, converted or restored in the period (Indian time). The log can't be switched off or changed. Amount now is the entry's current total. IP address and device are shown only to roles with the audit right.",
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
