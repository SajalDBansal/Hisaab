import {
  IdParams,
  ItemParties,
  PartyItemParams,
  PartyItems,
  TradeRateEntry,
} from "@repo/contracts";
import {
  canSeeCosts,
  openingStockLeft,
  tradeRateHistory,
  tradeRates,
  type Role,
} from "@repo/core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { notFound } from "@repo/backend/modules/masters/shared";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { canReadParty, forbiddenRead } from "../../lib/read-permissions";

type PartyType = "customer" | "supplier";

/** Supplier rates are purchase costs, so they need cost visibility too. */
const canReadRates = (role: Role, type: PartyType) =>
  canReadParty(role, type) && (type === "customer" || canSeeCosts(role));

type Reader = Pick<Db, "select">;

/** One consistent snapshot of the books per answer. */
const read = <T>(db: Db, work: (tx: Reader) => Promise<T>) =>
  db.transaction(work, {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });

/** Which products a party supplies or buys, at what rate, and who supplies or buys a product. */
export async function tradeRateRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  async function partyOf(tx: Reader, firmId: string, id: string, role: Role) {
    const books = await loadReportBooks(tx, firmId);
    const party = books.parties.find((p) => p.id === id);
    if (!party) throw notFound("party");
    if (!canReadRates(role, party.type)) throw forbiddenRead();
    return { books, party };
  }

  typed.get(
    "/parties/:id/items",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: PartyItems } },
    },
    (req) =>
      read(db, async (tx) => {
        const { books, party } = await partyOf(
          tx,
          req.firm.id,
          req.params.id,
          req.firm.role,
        );
        return {
          rows: tradeRates(books, { type: party.type, partyId: party.id }),
        };
      }),
  );

  typed.get(
    "/parties/:id/items/:itemId",
    {
      preHandler: app.inFirm(),
      schema: {
        params: PartyItemParams,
        response: { 200: z.array(TradeRateEntry) },
      },
    },
    (req) =>
      read(db, async (tx) => {
        const { books, party } = await partyOf(
          tx,
          req.firm.id,
          req.params.id,
          req.firm.role,
        );
        return tradeRateHistory(books, party, req.params.itemId);
      }),
  );

  typed.get(
    "/items/:id/parties",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: ItemParties } },
    },
    (req) =>
      read(db, async (tx) => {
        const books = await loadReportBooks(tx, req.firm.id);
        if (!books.items.some((i) => i.id === req.params.id))
          throw notFound("item");
        const role = req.firm.role;
        const costs = canReadRates(role, "supplier");
        return {
          suppliers: costs
            ? tradeRates(books, { type: "supplier", itemId: req.params.id })
            : null,
          customers: canReadRates(role, "customer")
            ? tradeRates(books, { type: "customer", itemId: req.params.id })
            : null,
          openingStock: costs ? openingStockLeft(books, req.params.id) : null,
        };
      }),
  );
}
