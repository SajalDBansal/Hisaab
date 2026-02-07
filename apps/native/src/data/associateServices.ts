import { z } from "zod";
import * as c from "@repo/contracts/src/associates";
import { queryString, type Client } from "./client";
import { matchVersion } from "./masterServices";

export function associateServices(client: Client) {
  return {
    list: () => client.pages("/associates", c.AssociateRecord),
    options: () =>
      client.request("/associates/options", z.array(c.AssociateOption)),
    fields: () =>
      client.request("/associates/fields", z.array(c.AssociateField)),
    saveField: (input: c.AssociateFieldInput, id?: string, version?: number) =>
      client.request(
        id ? `/associates/fields/${id}/update` : "/associates/fields",
        c.AssociateField,
        {
          body: c.AssociateFieldInput.parse(input),
          headers: id ? matchVersion(version!) : undefined,
        },
      ),
    get: (id: string) => client.request(`/associates/${id}`, c.AssociateDetail),
    statement: (id: string, query: c.AssociateStatementQuery) =>
      client.request(
        `/associates/${id}/statement${queryString(query)}`,
        c.AssociateStatement,
      ),
    create: (input: c.AssociateInput) =>
      client.request("/associates", c.AssociateRecord, {
        body: c.AssociateInput.parse(input),
      }),
    update: (id: string, input: c.AssociateUpdate, version: number) =>
      client.request(`/associates/${id}/update`, c.AssociateRecord, {
        body: c.AssociateUpdate.parse(input),
        headers: matchVersion(version),
      }),
    delivery: (id: string, input: c.DeliveryUpdate, version: number) =>
      client.request(
        `/associates/deliveries/${id}/update`,
        c.DeliveryAssignment,
        { body: c.DeliveryUpdate.parse(input), headers: matchVersion(version) },
      ),
    payout: (id: string, input: c.AssociatePayoutInput, version: number) =>
      client.request(`/associates/${id}/payouts`, c.AssociatePayout, {
        body: c.AssociatePayoutInput.parse(input),
        headers: matchVersion(version),
      }),
    reverse: (id: string, input: c.AssociatePayoutReversal, version: number) =>
      client.request(`/associates/payouts/${id}/reverse`, c.AssociatePayout, {
        body: c.AssociatePayoutReversal.parse(input),
        headers: matchVersion(version),
      }),
  };
}
export type AssociateService = ReturnType<typeof associateServices>;
