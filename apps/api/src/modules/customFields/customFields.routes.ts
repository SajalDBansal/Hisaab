import { CustomField, CustomFieldInput, IdParams } from "@repo/contracts";
import { newCustomFieldKey, type CustomFieldDef } from "@repo/core";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import {
  loadCustomFieldDefs,
  toCustomFieldDef,
} from "@repo/backend/modules/customFields/customFields.repo";
import { expectedVersion } from "@repo/backend/modules/masters/shared";

const out = (d: CustomFieldDef) => CustomField.parse(d);
const MAX_FIELDS_PER_ENTITY = 20;

/**
 * Custom field definitions for parties, items and voucher headers (doc 37, T07).
 * Everyone in the firm reads them (forms need them); changing them is a
 * settings right. Fields are switched off, never deleted, and a field's type
 * and existing choices never change, so stored values keep their meaning.
 */
export async function customFieldRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/settings/custom-fields",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: z.array(CustomField) } },
    },
    async (req) => (await loadCustomFieldDefs(db, req.firm.id)).map(out),
  );

  typed.post(
    "/settings/custom-fields",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: CustomFieldInput, response: { 201: CustomField } },
    },
    async (req, reply) => {
      const { entity, ...definition } = req.body;
      const created = await withFirmWrite(db, req.firm.id, async (tx) => {
        const existing = (await loadCustomFieldDefs(tx, req.firm.id)).filter(
          (d) => d.entity === entity,
        );
        if (existing.length >= MAX_FIELDS_PER_ENTITY)
          throw new AppError(
            "TOO_MANY_FIELDS",
            `Up to ${MAX_FIELDS_PER_ENTITY} custom fields each for parties, items and vouchers.`,
            409,
          );
        if (
          existing.some(
            (d) => d.name.toLowerCase() === definition.name.toLowerCase(),
          )
        )
          throw new AppError(
            "DUPLICATE",
            "A field with this name already exists.",
            409,
            { name: "A field with this name already exists." },
          );
        const [row] = await tx
          .insert(schema.customFields)
          .values({
            id: uuidv7(),
            firmId: req.firm.id,
            key: newCustomFieldKey(),
            entity,
            definition,
            position: existing.length,
          })
          .returning();
        return toCustomFieldDef(row);
      });
      return reply.code(201).send(out(created));
    },
  );

  typed.put(
    "/settings/custom-fields/:id",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        params: IdParams,
        body: CustomFieldInput,
        response: { 200: CustomField },
      },
    },
    async (req) => {
      const version = expectedVersion(req.headers["if-match"]);
      const { entity, ...definition } = req.body;
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const [before] = await tx
          .select()
          .from(schema.customFields)
          .where(
            and(
              eq(schema.customFields.firmId, req.firm.id),
              eq(schema.customFields.id, req.params.id),
            ),
          );
        if (!before)
          throw new AppError("NOT_FOUND", "That field was not found.", 404);
        if (before.version !== version)
          throw new AppError(
            "EDITED_ELSEWHERE",
            "Someone changed this field. Reload and try again.",
            409,
          );
        const old = toCustomFieldDef(before);
        if (
          entity !== old.entity ||
          definition.kind !== old.kind ||
          old.choices.some((choice) => !definition.choices.includes(choice))
        )
          throw new AppError(
            "FIELD_TYPE_FIXED",
            "A field's type, record and existing choices can't change; add new choices or make a new field.",
            409,
          );
        const [row] = await tx
          .update(schema.customFields)
          .set({
            definition,
            version: sql`${schema.customFields.version} + 1`,
          })
          .where(eq(schema.customFields.id, before.id))
          .returning();
        return toCustomFieldDef(row);
      });
      return out(saved);
    },
  );
}
