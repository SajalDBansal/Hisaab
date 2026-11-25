import * as c from "@repo/contracts";
import type { catalogService } from "@repo/core";
import type { Client } from "./client";
import { matchVersion } from "./masterServices";

/** The catalogue settings (doc 37, Phase 2) against the API; same shapes as the demo. */
export function catalogServices(client: Client): typeof catalogService {
  const { request } = client;
  return {
    salespersons: () => request("/settings/salespersons", c.SalespersonList),
    saveSalesperson: (input, id?: string, version?: number) =>
      id
        ? request(`/settings/salespersons/${id}`, c.Salesperson, {
            method: "PUT",
            body: input,
            headers: matchVersion(version),
          })
        : request("/settings/salespersons", c.Salesperson, { body: input }),
  };
}
