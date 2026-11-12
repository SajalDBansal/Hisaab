import {
  DashboardData,
  ExpenseSummary,
  FinalAccounts,
  Outstanding,
  OutstandingQuery,
  AsOfQuery,
  ReportPeriodQuery,
  StockSummary,
  StockSummaryQuery,
  TradeSummary,
  TradeSummaryQuery,
  TrialBalance,
  ReportRequest,
  ReportDocument,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { reportsService } from "./reports.service";

export async function reportRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const read = app.inFirm("reports");

  typed.post(
    "/reports/export",
    {
      preHandler: read,
      config: { readOnly: true },
      schema: { body: ReportRequest, response: { 200: ReportDocument } },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return reportsService.exportReport(db, req.firm.id, req.body);
    },
  );

  typed.get(
    "/reports/dashboard",
    {
      preHandler: read,
      schema: {
        querystring: StockSummaryQuery,
        response: { 200: DashboardData },
      },
    },
    async (req) => reportsService.dashboard(db, req.firm.id, req.query.tax),
  );

  typed.get(
    "/reports/outstanding",
    {
      preHandler: read,
      schema: {
        querystring: OutstandingQuery,
        response: { 200: Outstanding },
      },
    },
    async (req) =>
      reportsService.outstanding(
        db,
        req.firm.id,
        req.query.type,
        req.query.tax,
      ),
  );

  typed.get(
    "/reports/sale-summary",
    {
      preHandler: read,
      schema: {
        querystring: TradeSummaryQuery,
        response: { 200: TradeSummary },
      },
    },
    async (req) =>
      reportsService.tradeSummary(
        db,
        req.firm.id,
        "sale",
        req.query.period,
        req.query.tax,
      ),
  );

  typed.get(
    "/reports/purchase-summary",
    {
      preHandler: read,
      schema: {
        querystring: TradeSummaryQuery,
        response: { 200: TradeSummary },
      },
    },
    async (req) =>
      reportsService.tradeSummary(
        db,
        req.firm.id,
        "purchase",
        req.query.period,
        req.query.tax,
      ),
  );

  typed.get(
    "/reports/expenses",
    {
      preHandler: read,
      schema: {
        querystring: ReportPeriodQuery,
        response: { 200: ExpenseSummary },
      },
    },
    async (req) =>
      reportsService.expenses(db, req.firm.id, req.query.period, req.query.tax),
  );

  typed.get(
    "/reports/stock",
    {
      preHandler: read,
      schema: {
        querystring: StockSummaryQuery,
        response: { 200: StockSummary },
      },
    },
    async (req) => reportsService.stock(db, req.firm.id, req.query.tax),
  );

  typed.get(
    "/reports/trial-balance",
    {
      preHandler: read,
      schema: {
        querystring: AsOfQuery,
        response: { 200: TrialBalance },
      },
    },
    async (req) =>
      reportsService.trialBalance(
        db,
        req.firm.id,
        req.query.asOf,
        req.query.tax,
      ),
  );

  typed.get(
    "/reports/final-accounts",
    {
      preHandler: read,
      schema: {
        querystring: AsOfQuery,
        response: { 200: FinalAccounts },
      },
    },
    async (req) =>
      reportsService.finalAccounts(
        db,
        req.firm.id,
        req.query.asOf,
        req.query.tax,
        req.query.from,
      ),
  );
}
