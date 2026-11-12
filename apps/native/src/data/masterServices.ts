import * as c from "@repo/contracts";
import { stockValue } from "@repo/core";
import { z } from "zod";
import { type Client, queryString } from "./client";
import type { Services } from "./services";

// Updates require the version shown when the form opened, never a freshly fetched version.
export function matchVersion(version?: number) {
  if (version === undefined)
    throw new Error("Reopen this entry before editing it.");
  return { "if-match": String(version) };
}

export function masterServices(client: Client) {
  const { request, pages } = client;
  return {
    partyService: {
      allocatePayments: (id) =>
        request(
          `/parties/${id}/allocate-payments`,
          z.object({ allocated: c.NonNegativePaise }),
          { body: {} },
        ),
      list: async (type) =>
        (
          await pages("/parties", c.PartyListRow, { type, sort: "balance" })
        ).map((party) => ({
          party,
          balance: party.balance,
          overdueAmount: party.overdueAmount,
          maxOverdueDays: party.maxOverdueDays,
        })),
      get: (id) => request(`/parties/${id}`, c.PartyDetail),
      items: (id) => request(`/parties/${id}/items`, c.PartyItems),
      itemRates: (id, itemId) =>
        request(`/parties/${id}/items/${itemId}`, z.array(c.TradeRateEntry)),
      create: (input) => request("/parties", c.PartyRow, { body: input }),
      update: (id, input, version?: number) =>
        request(`/parties/${id}`, c.PartyRow, {
          method: "PUT",
          body: input,
          headers: matchVersion(version),
        }),
    } satisfies Services["partyService"],
    itemService: {
      lots: (date) =>
        request(
          `/items/stock-lots${queryString({ date })}`,
          z.array(c.StockLot),
        ),
      list: async () =>
        (await pages("/items", c.ItemRow)).map((item) => ({
          item,
          qty: item.stock,
          value: item.value ?? stockValue(item, item.stock),
          lowStock: item.lowStock,
        })),
      get: (id) => request(`/items/${id}`, c.ItemDetail),
      parties: (id) => request(`/items/${id}/parties`, c.ItemParties),
      create: (input) => request("/items", c.ItemRow, { body: input }),
      update: (id, input, version?: number) =>
        request(`/items/${id}`, c.ItemRow, {
          method: "PUT",
          body: input,
          headers: matchVersion(version),
        }),
    } satisfies Services["itemService"],
    ledgerService: {
      create: (input) => request("/ledgers", c.LedgerRow, { body: input }),
      listCashAndBank: async () =>
        (await request("/ledgers", z.array(c.LedgerRow))).map((ledger) => ({
          ledger,
          balance: ledger.balance,
        })),
      statement: (id, tax) =>
        request(
          `/ledgers/${id}/statement${queryString({ tax })}`,
          c.LedgerStatement,
        ),
    } satisfies Services["ledgerService"],
    unitService: {
      list: () => request("/units", z.array(c.UnitRow)),
      add: (input) => request("/units", c.UnitRow, { body: input }),
      setEnabled: (name, enabled) =>
        request(`/units/${encodeURIComponent(name)}`, c.UnitRow, {
          method: "PATCH",
          body: { enabled },
        }),
      remove: async (name) => {
        await request(
          `/units/${encodeURIComponent(name)}`,
          z.object({ ok: z.boolean() }),
          { method: "DELETE" },
        );
      },
    } satisfies Services["unitService"],
  };
}
