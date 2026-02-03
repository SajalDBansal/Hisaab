import {
  CashForecast,
  CashForecastRequest,
} from "@repo/contracts/src/cashForecast";
import {
  buildCashForecast,
  CashForecastInputError,
} from "@repo/core/src/reporting/cashForecast";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { loadReportSnapshot } from "@repo/backend/modules/reports/books";

export const cashForecastService = {
  async forecast(db: Db, firmId: string, input: CashForecastRequest) {
    const request = CashForecastRequest.parse(input);
    const books = await loadReportSnapshot(db, firmId, {
      includeDeleted: true,
    });
    try {
      return buildCashForecast(books, request);
    } catch (error) {
      if (error instanceof CashForecastInputError)
        throw new AppError("INVALID_CASH_FORECAST", error.message);
      throw error;
    }
  },
};

export async function cashForecastRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/reports/cash-forecast",
    {
      preHandler: app.inFirm("reports"),
      schema: { body: CashForecastRequest, response: { 200: CashForecast } },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return cashForecastService.forecast(options.db, req.firm.id, req.body);
    },
  );
}
