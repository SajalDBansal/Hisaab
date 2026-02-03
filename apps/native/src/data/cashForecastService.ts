import {
  CashForecast,
  CashForecastRequest,
} from "@repo/contracts/src/cashForecast";
import { buildCashForecast } from "@repo/core/src/reporting/cashForecast";
import { getDb } from "@repo/core/src/services/client";
import type { Client } from "./client";

export interface CashForecastService {
  forecast(input: CashForecastRequest): Promise<CashForecast>;
}

export function cashForecastService(client: Client): CashForecastService {
  return {
    forecast: (input) =>
      client.request("/reports/cash-forecast", CashForecast, {
        body: CashForecastRequest.parse(input),
      }),
  };
}

export const demoCashForecastService: CashForecastService = {
  async forecast(input) {
    return CashForecast.parse(
      buildCashForecast(getDb(), CashForecastRequest.parse(input)),
    );
  },
};
