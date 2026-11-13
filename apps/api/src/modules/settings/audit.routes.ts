import {
  AuditEntry,
  AuditPage,
  AuditPageParams,
  Id,
  PageQuery,
  pageOf,
} from "@repo/contracts";
import { cursorOffset, pageCursor } from "@repo/core";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
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

  /** The Edit log screen: a page at a time, with a count for each filter. */
  app.withTypeProvider<ZodTypeProvider>().get(
    "/audit-log/page",
    {
      preHandler: app.inFirm("reports"),
      schema: {
        querystring: AuditPageParams,
        response: { 200: AuditPage },
      },
    },
    async (req) => {
      const log = schema.auditLog;
      const firm = eq(log.firmId, req.firm.id);
      const filter = req.query.filter ?? "all";
      const where =
        filter === "edited"
          ? and(firm, notInArray(log.action, ["created", "cancelled"]))
          : filter === "cancelled"
            ? and(firm, eq(log.action, "cancelled"))
            : firm;
      const offset = cursorOffset(req.query.cursor);
      const [[counts], rows] = await Promise.all([
        db
          .select({
            all: sql<number>`count(*)::int`,
            changes: sql<number>`(count(*) filter (where ${log.action} not in ('created', 'cancelled')))::int`,
            cancelled: sql<number>`(count(*) filter (where ${log.action} = 'cancelled'))::int`,
          })
          .from(log)
          .where(firm),
        db
          .select()
          .from(log)
          .where(where)
          .orderBy(desc(log.id))
          .offset(offset)
          .limit(req.query.limit + 1),
      ]);
      const total =
        filter === "edited"
          ? counts.changes
          : filter === "cancelled"
            ? counts.cancelled
            : counts.all;
      return {
        items: rows.slice(0, req.query.limit).map((row) =>
          AuditEntry.parse({
            ...row,
            at: row.at.toISOString(),
            note: row.note ?? undefined,
          }),
        ),
        nextCursor:
          rows.length > req.query.limit
            ? pageCursor(offset + req.query.limit)
            : null,
        total,
        summary: counts,
      };
    },
  );
}
