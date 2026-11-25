import {
  IdParams,
  Salesperson,
  SalespersonInput,
  SalespersonList,
} from "@repo/contracts";
import { checkSalesperson, salespersonOfUser } from "@repo/core";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import {
  loadSalespersons,
  toSalesperson,
} from "@repo/backend/modules/catalog/catalog.repo";
import {
  editedElsewhere,
  expectedVersion,
  invalidFields,
  notFound,
} from "@repo/backend/modules/masters/shared";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const out = (row: typeof schema.salespersons.$inferSelect) =>
  Salesperson.parse(toSalesperson(row));

/** Field checks, plus: a linked login must be a member of this firm. */
async function checked(
  tx: Tx | Db,
  firmId: string,
  input: SalespersonInput,
  id?: string,
) {
  const problems = checkSalesperson(
    input,
    await loadSalespersons(tx, firmId),
    id,
  );
  if (input.userId && !problems.userId) {
    const [member] = await tx
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, firmId),
          eq(schema.member.userId, input.userId),
        ),
      );
    if (!member) problems.userId = "Pick a member of this firm.";
  }
  const error = invalidFields(problems);
  if (error) throw error;
  return {
    name: input.name.trim(),
    userId: input.userId ?? null,
    phone: input.phone?.trim() ?? "",
    active: input.active,
  };
}

/**
 * Salespersons (doc 37, T10). Everyone in the firm reads them (sales forms
 * need them, offline too); `mine` is the caller's own salesperson, the forms'
 * default. Changing them is a settings right. They are switched off, never
 * deleted, so old entries keep their salesperson.
 */
export async function salespersonRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/settings/salespersons",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: SalespersonList } },
    },
    async (req) => {
      const rows = await loadSalespersons(db, req.firm.id);
      return {
        rows: rows.map((row) => Salesperson.parse(row)),
        mine: salespersonOfUser(rows, req.user.id)?.id ?? null,
      };
    },
  );

  typed.post(
    "/settings/salespersons",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: SalespersonInput, response: { 201: Salesperson } },
    },
    async (req, reply) => {
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const values = await checked(tx, req.firm.id, req.body);
        const [row] = await tx
          .insert(schema.salespersons)
          .values({ id: uuidv7(), firmId: req.firm.id, ...values })
          .returning();
        if (!row) throw notFound("salesperson");
        return row;
      });
      return reply.code(201).send(out(saved));
    },
  );

  typed.put(
    "/settings/salespersons/:id",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        params: IdParams,
        body: SalespersonInput,
        response: { 200: Salesperson },
      },
    },
    async (req) => {
      const version = expectedVersion(req.headers["if-match"]);
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.salespersons)
          .where(
            and(
              eq(schema.salespersons.firmId, req.firm.id),
              eq(schema.salespersons.id, req.params.id),
            ),
          );
        if (!before) throw notFound("salesperson");
        if (before.version !== version) throw editedElsewhere("salesperson");
        const values = await checked(tx, req.firm.id, req.body, before.id);
        const [row] = await tx
          .update(schema.salespersons)
          .set({
            ...values,
            version: sql`${schema.salespersons.version} + 1`,
          })
          .where(eq(schema.salespersons.id, before.id))
          .returning();
        if (!row) throw notFound("salesperson");
        return row;
      });
      return out(saved);
    },
  );
}
