import {
  ReplicaChanges,
  ReplicaChangesQuery,
  ReplicaHead,
  ReplicaRows,
  ReplicaRowsQuery,
} from "@repo/contracts";
import {
  REPLICA_KINDS,
  replicaChecksum,
  replicaVoucher,
  type ReplicaKind,
  type ReplicaTables,
} from "@repo/core";
import type { Db as MockDb } from "@repo/core/src/mock/db";
import { and, asc, eq, gt, isNull, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { loadBookPart } from "@repo/backend/modules/reports/books";

type Reader = Pick<Db, "select" | "execute">;

/** Changes sent per answer; the phone asks again while `more`. */
const CHANGES_PER_PAGE = 2000;

const tablesOf = (books: MockDb): ReplicaTables => ({
  firm: books.firm,
  accounts: books.accounts,
  ledgers: books.ledgers,
  openingAccounts: books.openingAccounts,
  invoiceSettings: books.invoiceSettings,
  units: books.units,
  reminders: books.reminders,
});
const rowsOf = (books: MockDb, kind: ReplicaKind): unknown[] =>
  kind === "vouchers" ? books.vouchers.map(replicaVoucher) : books[kind];

const ENTITY_KIND: Record<string, ReplicaKind | undefined> = {
  party: "parties",
  item: "items",
  voucher: "vouchers",
};

/**
 * The books on the phone (owner, accountant and viewer: roles that read the
 * whole books). Each answer reads one repeatable-read snapshot, so the cursor
 * and the rows it reports belong to the same moment.
 */
export async function replicaRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const read = app.inFirm("reports");
  const snapshot = <T>(work: (tx: Reader) => Promise<T>) =>
    db.transaction(work, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  const lastSeq = async (tx: Reader, firmId: string) => {
    const [row] = await tx
      .select({ seq: max(schema.changeLog.seq) })
      .from(schema.changeLog)
      .where(eq(schema.changeLog.firmId, firmId));
    return Number(row?.seq ?? 0);
  };

  typed.get(
    "/replica/head",
    {
      preHandler: read,
      schema: { response: { 200: ReplicaHead } },
    },
    (req) =>
      snapshot(async (tx) => {
        const seq = await lastSeq(tx, req.firm.id);
        const books = await loadBookPart(tx, req.firm.id, {
          parties: "all",
          items: "all",
          vouchers: "all",
        });
        const per = <T>(f: (kind: ReplicaKind) => T) =>
          Object.fromEntries(REPLICA_KINDS.map((k) => [k, f(k)])) as Record<
            ReplicaKind,
            T
          >;
        return {
          seq,
          tables: tablesOf(books),
          counts: per((k) => rowsOf(books, k).length),
          checksum: per((k) => replicaChecksum(rowsOf(books, k))),
        };
      }),
  );

  typed.get(
    "/replica/rows",
    {
      preHandler: read,
      schema: { querystring: ReplicaRowsQuery, response: { 200: ReplicaRows } },
    },
    (req) =>
      snapshot(async (tx) => {
        const { kind, after, limit } = req.query;
        const table =
          kind === "parties"
            ? schema.parties
            : kind === "items"
              ? schema.items
              : schema.vouchers;
        // Pages by id: stable while other people keep saving.
        const ids = (
          await tx
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                eq(table.firmId, req.firm.id),
                after ? gt(table.id, after) : undefined,
                "deletedAt" in table ? isNull(table.deletedAt) : undefined,
              ),
            )
            .orderBy(asc(table.id))
            .limit(limit + 1)
        ).map((r) => r.id);
        const page = ids.slice(0, limit);
        const books = await loadBookPart(tx, req.firm.id, { [kind]: page });
        return {
          rows: rowsOf(books, kind),
          next: ids.length > limit ? (page.at(-1) ?? null) : null,
        };
      }),
  );

  typed.get(
    "/replica/changes",
    {
      preHandler: read,
      schema: {
        querystring: ReplicaChangesQuery,
        response: { 200: ReplicaChanges },
      },
    },
    (req) =>
      snapshot(async (tx) => {
        const firmId = req.firm.id;
        const since = req.query.since;
        const log = await tx
          .select({
            seq: schema.changeLog.seq,
            entity: schema.changeLog.entity,
            id: schema.changeLog.entityId,
          })
          .from(schema.changeLog)
          .where(
            and(
              eq(schema.changeLog.firmId, firmId),
              gt(schema.changeLog.seq, since),
            ),
          )
          .orderBy(asc(schema.changeLog.seq))
          .limit(CHANGES_PER_PAGE + 1);
        const page = log.slice(0, CHANGES_PER_PAGE);
        // A cursor past the end means the books were restored: start over.
        const reset = page.length === 0 && since > (await lastSeq(tx, firmId));
        const wanted: Record<ReplicaKind, Set<string>> = {
          parties: new Set(),
          items: new Set(),
          vouchers: new Set(),
        };
        for (const row of page) {
          const kind = ENTITY_KIND[row.entity];
          if (kind) wanted[kind].add(row.id);
        }
        const books = await loadBookPart(tx, firmId, {
          parties: [...wanted.parties],
          items: [...wanted.items],
          vouchers: [...wanted.vouchers],
        });
        const changes = Object.fromEntries(
          REPLICA_KINDS.map((kind) => {
            const upsert = rowsOf(books, kind);
            const present = new Set(
              upsert.map((row) => (row as { id: string }).id),
            );
            // Asked for but gone (removed parties and items): delete on the phone.
            const remove = [...wanted[kind]].filter((id) => !present.has(id));
            return [kind, { upsert, remove }];
          }),
        ) as Record<ReplicaKind, { upsert: unknown[]; remove: string[] }>;
        return {
          seq: Number(page.at(-1)?.seq ?? since),
          reset,
          more: log.length > CHANGES_PER_PAGE,
          tables: tablesOf(books),
          changes,
        };
      }),
  );
}
