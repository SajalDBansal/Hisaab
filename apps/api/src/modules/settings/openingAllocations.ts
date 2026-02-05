import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { and, eq, sql } from "drizzle-orm";
import {
  OpeningAllocationChange,
  OpeningAllocationView,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { idemOf, rememberAnswer, replayOf } from "@repo/backend/modules/vouchers/idempotency";

async function allocationView(
  db: Pick<Db, "select">,
  firmId: string,
  owner: boolean,
): Promise<OpeningAllocationView> {
  const books = await loadReportBooks(db, firmId);
  const [control] = await db
    .select()
    .from(schema.bookControls)
    .where(eq(schema.bookControls.firmId, firmId));
  const defaultGst = books.firm.gstRegistration !== "unregistered";
  const row = (
    kind: OpeningAllocationChange["kind"],
    key: string,
    name: string,
    total: number,
    gst?: number,
  ) => ({
    kind,
    key,
    name,
    total,
    gst: gst ?? (defaultGst ? total : 0),
    explicit: gst !== undefined,
  });
  const rows = [
    ...books.parties.map((p) =>
      row("party", p.id, p.name, p.openingBalance, p.openingGstBalance),
    ),
    ...books.ledgers.map((l) =>
      row("ledger", l.id, l.name, l.openingBalance, l.openingGstBalance),
    ),
    ...(books.accounts ?? []).map((a) =>
      row("account", a.id, a.name, a.openingBalance, a.openingGstBalance),
    ),
    ...books.openingAccounts.map((a) =>
      row("legacy", a.account, a.account, a.amount, a.openingGstAmount),
    ),
  ]
    .filter((a) => a.total !== 0 || a.explicit)
    .sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`));
  return {
    rows,
    version: control?.version ?? 0,
    canEdit: owner && !control?.openingApprovedAt && !control?.closedThrough,
    digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  };
}

function checkChange(
  view: OpeningAllocationView,
  input: OpeningAllocationChange,
) {
  if (!view.canEdit)
    throw new AppError(
      "OPENINGS_LOCKED",
      "Reopen opening balances and all periods before changing allocations.",
      409,
    );
  if (view.version !== input.version || view.digest !== input.digest)
    throw new AppError(
      "EDITED_ELSEWHERE",
      "Opening balances changed. Reload and review them again.",
      409,
    );
  const row = view.rows.find(
    (r) => r.kind === input.kind && r.key === input.key,
  );
  if (!row)
    throw new AppError(
      "NOT_FOUND",
      "Opening balance not found in this firm.",
      404,
    );
  if (
    input.gst !== null &&
    (input.gst < Math.min(0, row.total) || input.gst > Math.max(0, row.total))
  )
    throw new AppError(
      "INVALID_ALLOCATION",
      "The GST share must have the same sign and cannot exceed the total opening balance.",
      400,
    );
  return row;
}

export async function openingAllocationRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/settings/books/allocations",
    {
      preHandler: app.inFirm("accounts"),
      schema: { response: { 200: OpeningAllocationView } },
    },
    (req) =>
      db.transaction(
        (tx) => allocationView(tx, req.firm.id, req.firm.role === "owner"),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  );
  typed.post(
    "/settings/books/allocations",
    {
      preHandler: app.inFirm("settings"),
      schema: {
        body: OpeningAllocationChange,
        response: { 200: OpeningAllocationView },
      },
    },
    async (req) => {
      if (req.firm.role !== "owner")
        throw new AppError(
          "FORBIDDEN",
          "Only the owner can allocate opening balances.",
          403,
        );
      const key = req.headers["idempotency-key"];
      const idem = idemOf(typeof key === "string" ? key : undefined, {
        firmId: req.firm.id,
        route: "/settings/books/allocations",
        body: req.body,
      });
      return withFirmWrite(db, req.firm.id, async (tx) => {
        if (idem) {
          const saved = await replayOf<OpeningAllocationView>(
            tx,
            req.user.id,
            idem,
          );
          if (saved) return saved;
        }
        const before = await allocationView(tx, req.firm.id, true);
        const previous = checkChange(before, req.body);
        const { kind, key, gst } = req.body;
        if (kind === "legacy") {
          await tx
            .update(schema.openingAccounts)
            .set({ openingGstAmount: gst })
            .where(
              and(
                eq(schema.openingAccounts.firmId, req.firm.id),
                eq(schema.openingAccounts.account, key),
              ),
            );
        } else {
          const table =
            kind === "party"
              ? schema.parties
              : kind === "ledger"
                ? schema.ledgers
                : schema.accounts;
          await tx
            .update(table)
            .set({
              openingGstBalance: gst,
              version: sql`${table.version} + 1`,
              updatedAt: new Date(),
            })
            .where(and(eq(table.firmId, req.firm.id), eq(table.id, key)));
        }
        const version = before.version + 1;
        await tx
          .insert(schema.bookControls)
          .values({ firmId: req.firm.id, version })
          .onConflictDoUpdate({
            target: schema.bookControls.firmId,
            set: { version },
          });
        await tx.insert(schema.bookControlEvents).values({
          id: uuidv7(),
          firmId: req.firm.id,
          action: "allocate-openings",
          reason: req.body.reason,
          userId: req.user.id,
          userName: req.user.name,
          before: previous,
          after: { kind, key, gst },
        });
        const result = await allocationView(tx, req.firm.id, true);
        if (idem) await rememberAnswer(tx, req.user.id, idem, 200, result);
        return result;
      });
    },
  );
}
