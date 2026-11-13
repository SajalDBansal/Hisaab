import {
  IdParams,
  ItemInput,
  ItemListParams,
  ItemRow,
  ItemDetail,
  StockLot,
  IsoDate,
  ListPageQuery,
  MovementPage,
  NewUnitInput,
  UnitParams,
  UnitRow,
  UnitUpdate,
  pageOf as pageSchema,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { itemsRepo } from "./items.repo";
import { itemsService, toItemRow } from "./items.service";
import {
  expectedVersion,
  pageOf,
  pageStart,
} from "@repo/backend/modules/masters/shared";
import { unitsService } from "./units.service";
import { readItem, readItemMovements } from "./views.service";
import { createListCache, listKey } from "../../lib/list-cache";
import { stockLots, inventoryValue, pageRows } from "@repo/core";
import { loadReportBooks } from "@repo/backend/modules/reports/books";

const Ok = z.object({ ok: z.literal(true) });

/** Item and stock selectors are shared; detailed movement and profit reports are restricted. */
export async function itemRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const writeItems = app.inFirm(["sales", "purchase"]);
  const writeUnits = app.inFirm("settings");
  const movements = createListCache();
  typed.get(
    "/items/stock-lots",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: z.object({ date: IsoDate.optional() }),
        response: { 200: z.array(StockLot) },
      },
    },
    async (req) =>
      db.transaction(
        async (tx) => {
          const b = await loadReportBooks(tx, req.firm.id);
          return b.items.flatMap((i) =>
            stockLots(i, b.vouchers, req.query.date),
          );
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  );

  // ---- Items ----------------------------------------------------------------

  typed.get(
    "/items",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: ItemListParams,
        response: { 200: pageSchema(ItemRow) },
      },
    },
    async (req) => {
      const start = pageStart(req.query.cursor);
      const rows = await itemsRepo.list(db, req.firm.id, {
        ...req.query,
        offset: start,
      });
      const books = await loadReportBooks(db, req.firm.id);
      return pageOf(
        rows.map((r) => ({
          ...toItemRow(r),
          value: inventoryValue(toItemRow(r), books.vouchers),
        })),
        start,
        req.query.limit,
      );
    },
  );

  typed.get(
    "/items/:id",
    {
      // The detail contains purchase movements and profit; selectors use /items and /items/stock-lots.
      preHandler: app.inFirm(["purchase", "reports"]),
      schema: { params: IdParams, response: { 200: ItemDetail } },
    },
    async (req) => readItem(db, req.firm.id, req.params.id),
  );

  typed.get(
    "/items/:id/movements",
    {
      // Movements show purchases, so the item detail rule applies.
      preHandler: app.inFirm(["purchase", "reports"]),
      schema: {
        params: IdParams,
        querystring: ListPageQuery,
        response: { 200: MovementPage },
      },
    },
    async (req) => ({
      ...pageRows(
        await movements(listKey(req, `movements:${req.params.id}`), () =>
          readItemMovements(db, req.firm.id, req.params.id),
        ),
        req.query,
      ),
      summary: null,
    }),
  );

  typed.post(
    "/items",
    {
      preHandler: writeItems,
      schema: { body: ItemInput, response: { 201: ItemRow } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await itemsService.create(db, req.firm.id, req.body, req.firm.role),
        ),
  );

  typed.put(
    "/items/:id",
    {
      preHandler: writeItems,
      schema: { params: IdParams, body: ItemInput, response: { 200: ItemRow } },
    },
    async (req) =>
      itemsService.update(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.body,
        req.firm.role,
      ),
  );

  typed.delete(
    "/items/:id",
    {
      preHandler: writeItems,
      schema: { params: IdParams, response: { 200: Ok } },
    },
    async (req) => {
      await itemsService.remove(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
      );
      return { ok: true as const };
    },
  );

  // ---- Units ----------------------------------------------------------------

  typed.get(
    "/units",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(UnitRow) } },
    },
    async (req) => unitsService.list(db, req.firm.id),
  );

  typed.post(
    "/units",
    {
      preHandler: writeUnits,
      schema: { body: NewUnitInput, response: { 201: UnitRow } },
    },
    async (req, reply) =>
      reply.code(201).send(await unitsService.add(db, req.firm.id, req.body)),
  );

  typed.patch(
    "/units/:name",
    {
      preHandler: writeUnits,
      schema: {
        params: UnitParams,
        body: UnitUpdate,
        response: { 200: UnitRow },
      },
    },
    async (req) =>
      unitsService.setEnabled(
        db,
        req.firm.id,
        req.params.name,
        req.body.enabled,
      ),
  );

  typed.delete(
    "/units/:name",
    {
      preHandler: writeUnits,
      schema: { params: UnitParams, response: { 200: Ok } },
    },
    async (req) => {
      await unitsService.remove(db, req.firm.id, req.params.name);
      return { ok: true as const };
    },
  );
}
