import {
  computeDashboard,
  buildReport,
  ReportInputError,
  type ReportRequest,
  expenseSummary,
  finalAccounts,
  outstanding,
  periodRange,
  stockSummary,
  today,
  tradeSummary,
  trialBalance,
  scopeBooks,
  financialYear,
  type ISODate,
  type PartyType,
  type PeriodKey,
  type TaxScope,
} from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import { loadReportSnapshot } from "@repo/backend/modules/reports/books";
import { AppError } from "@repo/backend/lib/app-error";

const books = async (db: Db, firmId: string, tax: TaxScope = "all") =>
  scopeBooks(
    await loadReportSnapshot(db, firmId, { includeDeleted: true }),
    tax,
  );

export const reportsService = {
  /** A repeatable-read snapshot keeps all exported totals consistent during concurrent edits. */
  async exportReport(db: Db, firmId: string, request: ReportRequest) {
    const b = await loadReportSnapshot(db, firmId, { includeDeleted: true });
    try {
      return buildReport(b, request);
    } catch (error) {
      if (error instanceof ReportInputError)
        throw new AppError("INVALID_REPORT", error.message);
      throw error;
    }
  },

  /** Everything the Home screen needs, calculated from the firm's live books. */
  async dashboard(db: Db, firmId: string, tax: TaxScope = "all") {
    const b = await books(db, firmId, tax);
    return computeDashboard({
      parties: b.parties,
      items: b.items,
      ledgers: b.ledgers,
      vouchers: b.vouchers,
      asOf: today(),
      firm: b.firm,
    });
  },

  /** Customer receivables or supplier payables with ageing buckets. */
  async outstanding(
    db: Db,
    firmId: string,
    type: PartyType,
    tax: TaxScope = "all",
  ) {
    const b = await books(db, firmId, tax);
    return outstanding(type, b.parties, b.vouchers, today());
  },

  /** Sales or purchases for one standard period and GST scope. */
  async tradeSummary(
    db: Db,
    firmId: string,
    kind: "sale" | "purchase",
    period: PeriodKey,
    scope: TaxScope,
  ) {
    const b = await books(db, firmId);
    const { from, to } = periodRange(period);
    return tradeSummary(kind, b.vouchers, b.parties, b.items, from, to, scope);
  },

  /** Expense accounts in the period, matching the P&L view. */
  async expenses(
    db: Db,
    firmId: string,
    period: PeriodKey,
    tax: TaxScope = "all",
  ) {
    const b = await books(db, firmId, tax);
    const { from, to } = periodRange(period);
    return expenseSummary(b.vouchers, from, to, b.accounts);
  },

  /** Closing stock grouped by item group. */
  async stock(db: Db, firmId: string, scope: TaxScope) {
    const b = await books(db, firmId);
    return stockSummary(b.items, b.vouchers, scope);
  },

  /** Closing balances in trial balance format. */
  async trialBalance(
    db: Db,
    firmId: string,
    asOf?: ISODate,
    tax: TaxScope = "all",
  ) {
    return trialBalance(await books(db, firmId, tax), asOf);
  },

  /** Profit and loss plus balance sheet. */
  async finalAccounts(
    db: Db,
    firmId: string,
    asOf = today(),
    tax: TaxScope = "all",
    from = financialYear(asOf).start,
  ) {
    return finalAccounts(await books(db, firmId, tax), asOf, from);
  },
};
