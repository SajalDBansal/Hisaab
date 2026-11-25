import { IdParams, PriceList, PriceListInput } from "@repo/contracts";
import {
  canSeeCosts,
  checkPriceList,
  cleanPriceList,
  type PricedItem,
} from "@repo/core";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import {
  editedElsewhere,
  expectedVersion,
  invalidFields,
  notFound,
} from "@repo/backend/modules/masters/shared";

type Reader = Pick<Db, "select">;
type Row = typeof schema.priceLists.$inferSelect;
const { priceLists, items } = schema;

const out = (row: Row) =>
  PriceList.parse({
    id: row.id,
    name: row.name,
    side: row.side,
    mode: row.mode,
    ...(row.percent === null ? {} : { percent: row.percent }),
    rates: row.rates,
    isDefault: row.isDefault,
    active: row.active,
    version: row.version,
  });

/** The firm's live items, as the price list rules need them. */
async function pricedItems(db: Reader, firmId: string): Promise<PricedItem[]> {
  const rows = await db
    .select({
      id: items.id,
      name: items.name,
      code: items.code,
      unit: items.unit,
      altUnitName: items.altUnitName,
      altUnitFactor: items.altUnitFactor,
      salePrice: items.salePrice,
      purchasePrice: items.purchasePrice,
    })
    .from(items)
    .where(and(eq(items.firmId, firmId), isNull(items.deletedAt)));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    unit: r.unit,
    salePrice: r.salePrice,
    purchasePrice: r.purchasePrice,
    ...(r.altUnitName && r.altUnitFactor
      ? { altUnit: { name: r.altUnitName, factor: r.altUnitFactor } }
      : {}),
  }));
}

/** Purchase lists are costs (doc 37, T36): only roles that see costs read or change them. */
function requireSide(role: Parameters<typeof canSeeCosts>[0], side: string) {
  if (side === "purchase" && !canSeeCosts(role))
    throw new AppError(
      "FORBIDDEN",
      "Purchase price lists are set by the owner or accountant.",
      403,
    );
}

async function checked(
  tx: Reader,
  firmId: string,
  input: PriceListInput,
  id?: string,
) {
  const others = await tx
    .select({ id: priceLists.id, name: priceLists.name })
    .from(priceLists)
    .where(eq(priceLists.firmId, firmId));
  const firmItems = await pricedItems(tx, firmId);
  const error = invalidFields(checkPriceList(input, others, firmItems, id));
  if (error) throw error;
  const clean = cleanPriceList(input, firmItems);
  return {
    name: clean.name,
    side: clean.side,
    mode: clean.mode,
    percent: clean.percent ?? null,
    rates: clean.rates,
    isDefault: clean.isDefault,
    active: clean.active,
  };
}

/** A new default list replaces the side's old default. */
async function clearOtherDefault(
  tx: Pick<Db, "update">,
  firmId: string,
  side: "sale" | "purchase",
  id: string,
) {
  await tx
    .update(priceLists)
    .set({ isDefault: false, version: sql`${priceLists.version} + 1` })
    .where(
      and(
        eq(priceLists.firmId, firmId),
        eq(priceLists.side, side),
        eq(priceLists.isDefault, true),
        ne(priceLists.id, id),
      ),
    );
}

/**
 * Price lists (doc 37, T36). Every member reads the sale lists (bill forms
 * need them, offline too); purchase lists only roles that see costs. Changing
 * them is a settings right. A list is switched off rather than deleted, since
 * parties point at it. Per-item rates come from the app's form or CSV import,
 * checked here against the firm's items.
 */
export async function priceListRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/settings/price-lists",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(PriceList) } },
    },
    async (req) => {
      const rows = await db
        .select()
        .from(priceLists)
        .where(eq(priceLists.firmId, req.firm.id))
        .orderBy(asc(priceLists.name), asc(priceLists.id));
      return rows
        .filter((r) => r.side === "sale" || canSeeCosts(req.firm.role))
        .map(out);
    },
  );

  typed.post(
    "/settings/price-lists",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: PriceListInput, response: { 201: PriceList } },
    },
    async (req, reply) => {
      requireSide(req.firm.role, req.body.side);
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const values = await checked(tx, req.firm.id, req.body);
        const id = uuidv7();
        if (values.isDefault)
          await clearOtherDefault(tx, req.firm.id, values.side, id);
        const [row] = await tx
          .insert(priceLists)
          .values({ id, firmId: req.firm.id, ...values })
          .returning();
        if (!row) throw notFound("price list");
        return row;
      });
      return reply.code(201).send(out(saved));
    },
  );

  typed.put(
    "/settings/price-lists/:id",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        params: IdParams,
        body: PriceListInput,
        response: { 200: PriceList },
      },
    },
    async (req) => {
      const version = expectedVersion(req.headers["if-match"]);
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const [before] = await tx
          .select()
          .from(priceLists)
          .where(
            and(
              eq(priceLists.firmId, req.firm.id),
              eq(priceLists.id, req.params.id),
            ),
          );
        if (!before) throw notFound("price list");
        requireSide(req.firm.role, before.side);
        if (before.version !== version) throw editedElsewhere("price list");
        if (req.body.side !== before.side)
          throw new AppError(
            "PRICE_LIST_SIDE_FIXED",
            "A price list's side can't change; make a new list.",
            409,
          );
        const values = await checked(tx, req.firm.id, req.body, before.id);
        if (values.isDefault)
          await clearOtherDefault(tx, req.firm.id, values.side, before.id);
        const [row] = await tx
          .update(priceLists)
          .set({ ...values, version: sql`${priceLists.version} + 1` })
          .where(eq(priceLists.id, before.id))
          .returning();
        if (!row) throw notFound("price list");
        return row;
      });
      return out(saved);
    },
  );
}
