import {
  expenseSummary,
  outstanding,
  stockSummary,
  tradeSummary,
  type ExpenseSummary,
  type Outstanding,
  type StockSummary,
  type TradeSummary,
} from "../accounting/analysis";
import { computeDashboard, type DashboardData } from "../accounting/reports";
import { periodRange, today, type PeriodKey } from "../dates";
import type { PartyType, TaxScope } from "../types";
import { buildReport, type ReportRequest } from "../reporting";
import { clone, delay, getDb } from "./client";
import { scopeBooks } from "../accounting/bookScope";

export const reportService = {
  async exportReport(request: ReportRequest) {
    await delay();
    return buildReport(getDb(), request);
  },

  /** Everything the Home screen shows. Real API: http.get<DashboardData>("/reports/dashboard") */
  async dashboard(tax: TaxScope = "all"): Promise<DashboardData> {
    await delay();
    const { parties, items, ledgers, vouchers, firm } = scopeBooks(
      getDb(),
      tax,
    );
    return clone(
      computeDashboard({
        parties,
        items,
        ledgers,
        vouchers,
        asOf: today(),
        firm,
      }),
    );
  },

  /** Receivables (customer) or payables (supplier) with ageing. Real API: http.get<Outstanding>(`/reports/outstanding?type=${type}`) */
  async outstanding(
    type: PartyType,
    tax: TaxScope = "all",
  ): Promise<Outstanding> {
    await delay();
    const { parties, vouchers } = scopeBooks(getDb(), tax);
    return clone(outstanding(type, parties, vouchers, today()));
  },

  /** Real API: http.get<TradeSummary>(`/reports/${kind}-summary?period=${period}&tax=${scope}`) */
  async tradeSummary(
    kind: "sale" | "purchase",
    period: PeriodKey,
    scope: TaxScope = "all",
  ): Promise<TradeSummary> {
    await delay();
    const { vouchers, parties, items } = getDb();
    const { from, to } = periodRange(period);
    return clone(tradeSummary(kind, vouchers, parties, items, from, to, scope));
  },

  /** Real API: http.get<ExpenseSummary>(`/reports/expenses?period=${period}`) */
  async expenses(
    period: PeriodKey,
    tax: TaxScope = "all",
  ): Promise<ExpenseSummary> {
    await delay();
    const { from, to } = periodRange(period);
    const db = scopeBooks(getDb(), tax);
    return clone(expenseSummary(db.vouchers, from, to, db.accounts));
  },

  /** Real API: http.get<StockSummary>(`/reports/stock?tax=${scope}`) */
  async stock(scope: TaxScope = "all"): Promise<StockSummary> {
    await delay();
    const { items, vouchers } = getDb();
    return clone(stockSummary(items, vouchers, scope));
  },
};
