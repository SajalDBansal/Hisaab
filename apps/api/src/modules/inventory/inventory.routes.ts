import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  IdempotencyHeaders,
  IdParams,
  PageQuery,
  Voucher,
  pageOf as pageSchema,
} from "@repo/contracts";
import {
  InventoryAdjustmentInput,
  InventoryReversalInput,
} from "@repo/contracts/src/inventory";
import { schema, type Db } from "@repo/backend/db/client";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { hydrateVouchers } from "@repo/backend/modules/vouchers/snapshot";
import { pageOf, pageStart } from "@repo/backend/modules/masters/shared";
import { writeInventoryAdjustment } from "./inventory.service";

export async function inventoryRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const actor = (req: FastifyRequest) => ({
    ...req.user,
    firmId: req.firm.id,
    idem: idemOf(String(req.headers["idempotency-key"]), {
      firmId: req.firm.id,
      route: `${req.method} ${req.url}`,
      body: req.body,
    }),
  });
  typed.get(
    "/inventory/adjustments",
    {
      preHandler: app.inFirm(["accounts", "reports"]),
      schema: {
        querystring: PageQuery,
        response: { 200: pageSchema(Voucher) },
      },
    },
    async (req) => {
      const start = pageStart(req.query.cursor);
      const rows = await db
        .select()
        .from(schema.vouchers)
        .where(
          and(
            eq(schema.vouchers.firmId, req.firm.id),
            isNotNull(schema.vouchers.inventoryAdjustment),
          ),
        )
        .orderBy(desc(schema.vouchers.date), desc(schema.vouchers.id))
        .limit(req.query.limit + 1)
        .offset(start);
      const loaded = await hydrateVouchers(db, rows);
      const versions = new Map(rows.map((row) => [row.id, row.version]));
      return pageOf(
        loaded.map((row) =>
          Voucher.parse({ ...row, version: versions.get(row.id) }),
        ),
        start,
        req.query.limit,
      );
    },
  );
  typed.post(
    "/inventory/adjustments",
    {
      preHandler: app.inFirm("accounts"),
      schema: {
        headers: IdempotencyHeaders,
        body: InventoryAdjustmentInput,
        response: { 201: Voucher },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await writeInventoryAdjustment(db, actor(req), req.body)),
  );
  typed.post(
    "/inventory/adjustments/:id/reverse",
    {
      preHandler: app.inFirm("accounts"),
      schema: {
        headers: IdempotencyHeaders,
        params: IdParams,
        body: InventoryReversalInput,
        response: { 201: Voucher },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await writeInventoryAdjustment(db, actor(req), undefined, {
            id: req.params.id,
            ...req.body,
          }),
        ),
  );
}
