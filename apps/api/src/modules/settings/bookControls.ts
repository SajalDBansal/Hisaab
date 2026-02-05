import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  openingPostings,
  openingStockValue,
  scopeBooks,
  today,
} from "@repo/core";
import {
  BookControlChange,
  BookControlView,
  BookControlHistoryQuery,
  BookControlHistoryPage,
} from "@repo/contracts";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { idemOf, rememberAnswer, replayOf } from "@repo/backend/modules/vouchers/idempotency";

async function controlView(
  db: Pick<Db, "select">,
  firmId: string,
  canManage: boolean,
): Promise<BookControlView> {
  const [control] = await db
    .select()
    .from(schema.bookControls)
    .where(eq(schema.bookControls.firmId, firmId));
  const books = await loadReportBooks(db, firmId);
  const rows = openingPostings(books).sort((a, b) =>
    a.account.localeCompare(b.account),
  );
  const capital = -(
    books.parties.reduce((sum, row) => sum + row.openingBalance, 0) +
    books.ledgers.reduce((sum, row) => sum + row.openingBalance, 0) +
    (books.accounts ?? []).reduce((sum, row) => sum + row.openingBalance, 0) +
    books.openingAccounts.reduce((sum, row) => sum + row.amount, 0) +
    openingStockValue(books.items)
  );
  const history = await db
    .select()
    .from(schema.bookControlEvents)
    .where(eq(schema.bookControlEvents.firmId, firmId))
    .orderBy(desc(schema.bookControlEvents.id))
    .limit(100);
  return {
    version: control?.version ?? 0,
    canManage,
    closedThrough: control?.closedThrough ?? null,
    openingApprovedAt: control?.openingApprovedAt?.toISOString() ?? null,
    openingApprovedBy: control?.openingApprovedBy ?? null,
    opening: {
      rows,
      capital,
      digest: createHash("sha256")
        .update(
          JSON.stringify({
            rows,
            capital,
            gst: openingPostings(scopeBooks(books, "gst")),
          }),
        )
        .digest("hex"),
    },
    history: history.map((row) => ({ ...row, at: row.at.toISOString() })),
  };
}

function changedControls(
  view: BookControlView,
  input: BookControlChange,
  userName: string,
) {
  if (input.version !== view.version)
    throw new AppError(
      "EDITED_ELSEWHERE",
      "Reload the control settings and try again.",
      409,
    );
  const next = {
    closedThrough: view.closedThrough,
    openingApprovedAt: view.openingApprovedAt
      ? new Date(view.openingApprovedAt)
      : null,
    openingApprovedBy: view.openingApprovedBy,
    version: view.version + 1,
  };
  switch (input.action) {
    case "approve-openings":
      if (
        view.openingApprovedAt ||
        input.digest !== view.opening.digest ||
        input.capital !== view.opening.capital
      )
        throw new AppError(
          "OPENINGS_CHANGED",
          "Opening balances changed or were already approved. Review them again.",
          409,
        );
      next.openingApprovedAt = new Date();
      next.openingApprovedBy = userName;
      break;
    case "close-period":
      if (!view.openingApprovedAt)
        throw new AppError(
          "APPROVAL_REQUIRED",
          "Review and approve the opening balances before closing a period.",
          409,
        );
      if (
        input.date > today() ||
        (view.closedThrough && input.date <= view.closedThrough)
      )
        throw new AppError(
          "INVALID_CLOSE_DATE",
          "Choose a later closing date no later than today.",
          400,
        );
      next.closedThrough = input.date;
      break;
    case "reopen-period":
      if (
        !view.closedThrough ||
        (input.date && input.date >= view.closedThrough)
      )
        throw new AppError(
          "INVALID_REOPEN_DATE",
          "Choose an earlier lock date or reopen all periods.",
          400,
        );
      next.closedThrough = input.date;
      break;
    case "reopen-openings":
      if (view.closedThrough)
        throw new AppError(
          "PERIOD_CLOSED",
          "Reopen all periods before changing opening balances.",
          409,
        );
      next.openingApprovedAt = null;
      next.openingApprovedBy = null;
  }
  return next;
}

export async function bookControlRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/settings/books/history",
    {
      preHandler: app.inFirm("accounts"),
      schema: {
        querystring: BookControlHistoryQuery,
        response: { 200: BookControlHistoryPage },
      },
    },
    async (req) => {
      const { cursor, limit } = req.query;
      const events = schema.bookControlEvents;
      // UUIDv7 keyset pagination does not skip older events when new ones arrive.
      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.firmId, req.firm.id),
            cursor ? lt(events.id, cursor) : undefined,
          ),
        )
        .orderBy(desc(events.id))
        .limit(limit + 1);
      const items = rows
        .slice(0, limit)
        .map((row) => ({ ...row, at: row.at.toISOString() }));
      return {
        items,
        nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
      };
    },
  );
  typed.get(
    "/settings/books",
    {
      preHandler: app.inFirm("accounts"),
      schema: { response: { 200: BookControlView } },
    },
    (req) =>
      db.transaction(
        (tx) => controlView(tx, req.firm.id, req.firm.role === "owner"),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  );
  typed.post(
    "/settings/books",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: BookControlChange, response: { 200: BookControlView } },
    },
    async (req) => {
      if (req.firm.role !== "owner")
        throw new AppError(
          "FORBIDDEN",
          "Only the owner can approve or reopen books.",
          403,
        );
      const key = req.headers["idempotency-key"];
      const idem = idemOf(typeof key === "string" ? key : undefined, {
        firmId: req.firm.id,
        route: "/settings/books",
        body: req.body,
      });
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${req.firm.id}, 0))`,
        );
        if (idem) {
          const saved = await replayOf<BookControlView>(tx, req.user.id, idem);
          if (saved) return saved;
        }
        const before = await controlView(tx, req.firm.id, true);
        const after = changedControls(before, req.body, req.user.name);
        await tx
          .insert(schema.bookControls)
          .values({ firmId: req.firm.id, ...after })
          .onConflictDoUpdate({
            target: schema.bookControls.firmId,
            set: after,
          });
        await tx.insert(schema.bookControlEvents).values({
          id: uuidv7(),
          firmId: req.firm.id,
          action: req.body.action,
          reason: req.body.reason,
          userId: req.user.id,
          userName: req.user.name,
          before: {
            closedThrough: before.closedThrough,
            openingApprovedAt: before.openingApprovedAt,
            opening: before.opening,
          },
          after,
        });
        const result = await controlView(tx, req.firm.id, true);
        if (idem) await rememberAnswer(tx, req.user.id, idem, 200, result);
        return result;
      });
    },
  );
}
