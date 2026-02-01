import { AuditEntry, Id, PageQuery, pageOf } from "@repo/contracts";
import { and, desc, eq, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";

// Keyset pagination keeps the full append-only history available without an unbounded query.
export async function auditRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/audit-log",
    {
      preHandler: app.inFirm("reports"),
      schema: {
        querystring: PageQuery.extend({ cursor: Id.optional() }),
        response: { 200: pageOf(AuditEntry) },
      },
    },
    async (req) => {
      const rows = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.firmId, req.firm.id),
            req.query.cursor
              ? lt(schema.auditLog.id, req.query.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(schema.auditLog.id))
        .limit(req.query.limit + 1);
      const items = rows.slice(0, req.query.limit).map((row) =>
        AuditEntry.parse({
          ...row,
          at: row.at.toISOString(),
          note: row.note ?? undefined,
        }),
      );
      return {
        items,
        nextCursor:
          rows.length > req.query.limit ? (items.at(-1)?.id ?? null) : null,
      };
    },
  );
}
