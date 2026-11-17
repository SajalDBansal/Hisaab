import { IdParams, RoleInput, RolesView, CustomRole } from "@repo/contracts";
import {
  BUILT_IN_ROLES,
  presetRights,
  roleInfo,
  roleProblem,
  type RoleRights,
} from "@repo/core";
import { and, count, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import {
  roleIdOf,
  toRoleDefinition,
} from "@repo/backend/modules/roles/roles.repo";
import { expectedVersion } from "@repo/backend/modules/masters/shared";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Clean a matrix: no duplicate actions, no empty entries. */
function cleanRights(rights: RoleRights): RoleRights {
  const vouchers: RoleRights["vouchers"] = {};
  for (const [type, actions] of Object.entries(rights.vouchers))
    if (actions?.length)
      vouchers[type as keyof RoleRights["vouchers"]] = [...new Set(actions)];
  return {
    permissions: [...new Set(rights.permissions)],
    vouchers,
    flags: rights.flags,
  };
}

/**
 * Custom roles (doc 37, T57). Everyone in the firm reads the roles (the app needs
 * its own rights); only the team right creates, changes or removes them.
 * Saving a role sends an access notice to every member holding it, so their app
 * and live connection pick up the new rights at once.
 */
export async function roleRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const memberCounts = async (tx: Pick<Db, "select">, firmId: string) => {
    const rows = await tx
      .select({ role: schema.member.role, members: count() })
      .from(schema.member)
      .where(eq(schema.member.organizationId, firmId))
      .groupBy(schema.member.role);
    return new Map(rows.map((r) => [r.role, Number(r.members)]));
  };

  const view = async (tx: Pick<Db, "select">, firmId: string) => {
    const [rows, counts] = await Promise.all([
      tx
        .select()
        .from(schema.customRoles)
        .where(eq(schema.customRoles.firmId, firmId))
        .orderBy(schema.customRoles.name),
      memberCounts(tx, firmId),
    ]);
    return {
      builtIn: BUILT_IN_ROLES.map((role) => ({
        role,
        label: roleInfo(role).label,
        note: roleInfo(role).note,
        rights: presetRights(role),
      })),
      custom: rows.map((row) => {
        const def = toRoleDefinition(row);
        return CustomRole.parse({
          id: def.id,
          name: def.name,
          description: def.description,
          rights: {
            permissions: def.permissions,
            vouchers: def.vouchers,
            flags: def.flags,
          },
          version: def.version,
          members: counts.get(def.id) ?? 0,
        });
      }),
    };
  };

  const checkInput = async (
    tx: Tx,
    firmId: string,
    input: z.infer<typeof RoleInput>,
    exceptId?: string,
  ) => {
    const problem = roleProblem(input.rights);
    if (problem) throw new AppError("INVALID_ROLE", problem, 400);
    const name = input.name.trim();
    const builtInName = BUILT_IN_ROLES.some(
      (role) => roleInfo(role).label.toLowerCase() === name.toLowerCase(),
    );
    const [clash] = await tx
      .select({ id: schema.customRoles.id })
      .from(schema.customRoles)
      .where(
        and(
          eq(schema.customRoles.firmId, firmId),
          sql`lower(${schema.customRoles.name}) = lower(${name})`,
          exceptId ? sql`${schema.customRoles.id} <> ${exceptId}` : undefined,
        ),
      );
    if (clash || builtInName)
      throw new AppError(
        "DUPLICATE",
        "A role with this name already exists.",
        409,
        {
          name: "A role with this name already exists.",
        },
      );
    return {
      name,
      description: input.description.trim(),
      rights: cleanRights(input.rights),
    };
  };

  /** Members holding the role get an access notice (UPDATE OF role fires the live trigger). */
  const announce = (tx: Tx, firmId: string, roleId: string) =>
    tx
      .update(schema.member)
      .set({ role: sql`${schema.member.role}` })
      .where(
        and(
          eq(schema.member.organizationId, firmId),
          eq(schema.member.role, roleId),
        ),
      );

  typed.get(
    "/firms/current/roles",
    { preHandler: app.inFirm(), schema: { response: { 200: RolesView } } },
    async (req) => view(db, req.firm.id),
  );

  typed.post(
    "/firms/current/roles",
    {
      preHandler: app.inFirm("team"),
      schema: { body: RoleInput, response: { 201: RolesView } },
    },
    async (req, reply) =>
      reply.code(201).send(
        await withFirmWrite(db, req.firm.id, async (tx) => {
          const clean = await checkInput(tx, req.firm.id, req.body);
          await tx
            .insert(schema.customRoles)
            .values({ id: uuidv7(), firmId: req.firm.id, ...clean });
          return view(tx, req.firm.id);
        }),
      ),
  );

  typed.put(
    "/firms/current/roles/:id",
    {
      preHandler: app.inFirm("team"),
      schema: {
        params: IdParams,
        body: RoleInput,
        response: { 200: RolesView },
      },
    },
    async (req) => {
      const version = expectedVersion(req.headers["if-match"]);
      return withFirmWrite(db, req.firm.id, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.customRoles)
          .where(
            and(
              eq(schema.customRoles.firmId, req.firm.id),
              eq(schema.customRoles.id, req.params.id),
            ),
          );
        if (!row)
          throw new AppError("NOT_FOUND", "That role was not found.", 404);
        if (row.version !== version)
          throw new AppError(
            "EDITED_ELSEWHERE",
            "Someone changed this role. Reload and try again.",
            409,
          );
        const clean = await checkInput(tx, req.firm.id, req.body, row.id);
        await tx
          .update(schema.customRoles)
          .set({
            ...clean,
            version: sql`${schema.customRoles.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.customRoles.id, row.id));
        await announce(tx, req.firm.id, roleIdOf(row));
        return view(tx, req.firm.id);
      });
    },
  );

  typed.delete(
    "/firms/current/roles/:id",
    {
      preHandler: app.inFirm("team"),
      schema: { params: IdParams, response: { 200: RolesView } },
    },
    async (req) =>
      withFirmWrite(db, req.firm.id, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.customRoles)
          .where(
            and(
              eq(schema.customRoles.firmId, req.firm.id),
              eq(schema.customRoles.id, req.params.id),
            ),
          );
        if (!row)
          throw new AppError("NOT_FOUND", "That role was not found.", 404);
        if ((await memberCounts(tx, req.firm.id)).get(roleIdOf(row)))
          throw new AppError(
            "ROLE_IN_USE",
            "Move the people who have this role to another role first.",
            409,
          );
        await tx
          .delete(schema.customRoles)
          .where(eq(schema.customRoles.id, row.id));
        return view(tx, req.firm.id);
      }),
  );
}
