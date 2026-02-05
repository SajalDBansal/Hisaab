import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { YearEndClose, YearEndQuery, YearEndView } from "@repo/contracts";
import {
  collectionBills,
  finalAccounts,
  scopeBooks,
  stockLots,
  stockVouchersAsOf,
  today,
  trialBalance,
} from "@repo/core";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { idemOf, rememberAnswer, replayOf } from "@repo/backend/modules/vouchers/idempotency";

async function yearReview(
  db: Pick<Db, "select">,
  firmId: string,
  year: number,
  owner: boolean,
): Promise<YearEndView> {
  const books = await loadReportBooks(db, firmId);
  const [control] = await db
    .select()
    .from(schema.bookControls)
    .where(eq(schema.bookControls.firmId, firmId));
  const from = `${year}-04-01`,
    to = `${year + 1}-03-31`,
    nextFrom = `${year + 1}-04-01`;
  const scopes = (["all", "gst", "nongst"] as const).map((tax) => {
    const scoped = scopeBooks(books, tax);
    const pending = (type: "customer" | "supplier") =>
      scoped.parties
        .filter((p) => p.type === type)
        .reduce(
          (sum, p) =>
            sum +
            collectionBills(p, scoped.vouchers, to).reduce(
              (s, bill) => s + bill.pending,
              0,
            ),
          0,
        );
    const stockEntries = stockVouchersAsOf(scoped.vouchers, to);
    return {
      tax,
      trialBalance: trialBalance(scoped, to),
      finalAccounts: finalAccounts(scoped, to, from),
      receivable: pending("customer"),
      payable: pending("supplier"),
      negativeLots: scoped.items.reduce(
        (sum, item) =>
          sum +
          stockLots(item, stockEntries).filter(
            (lot) => lot.qty < 0 || lot.minimumQty < 0,
          ).length,
        0,
      ),
    };
  });
  const blockers: string[] = [];
  if (!control?.openingApprovedAt)
    blockers.push("Opening balances need owner approval.");
  if (to >= today()) blockers.push("The financial year has not ended yet.");
  if (to < books.firm.fyStart)
    blockers.push("This year precedes the firm's books.");
  if (control?.closedThrough && to <= control.closedThrough)
    blockers.push("This financial year is already closed.");
  if (books.vouchers.some((v) => v.status === "draft" && v.date <= to))
    blockers.push("Post or cancel the drafts dated through this year end.");
  if (scopes.some((s) => s.negativeLots))
    blockers.push("Resolve negative stock lots before closing.");
  if (
    scopes.some(
      (s) =>
        s.trialBalance.totalDebit !== s.trialBalance.totalCredit ||
        !s.finalAccounts.balanceSheet.balanced,
    )
  )
    blockers.push("The financial statements do not balance.");
  return {
    year,
    from,
    to,
    nextFrom,
    scopes,
    blockers,
    version: control?.version ?? 0,
    canClose: owner && blockers.length === 0,
    digest: createHash("sha256")
      .update(JSON.stringify({ year, books }))
      .digest("hex"),
  };
}

export async function yearEndRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/settings/books/year-end",
    {
      preHandler: app.inFirm("accounts"),
      schema: { querystring: YearEndQuery, response: { 200: YearEndView } },
    },
    (req) =>
      db.transaction(
        (tx) =>
          yearReview(
            tx,
            req.firm.id,
            req.query.year,
            req.firm.role === "owner",
          ),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      ),
  );
  typed.post(
    "/settings/books/year-end",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: YearEndClose, response: { 200: YearEndView } },
    },
    async (req) => {
      if (req.firm.role !== "owner")
        throw new AppError(
          "FORBIDDEN",
          "Only the owner can close a financial year.",
          403,
        );
      const key = req.headers["idempotency-key"];
      const idem = idemOf(typeof key === "string" ? key : undefined, {
        firmId: req.firm.id,
        route: "/settings/books/year-end",
        body: req.body,
      });
      return withFirmWrite(db, req.firm.id, async (tx) => {
        if (idem) {
          const saved = await replayOf<YearEndView>(tx, req.user.id, idem);
          if (saved) return saved;
        }
        const before = await yearReview(tx, req.firm.id, req.body.year, true);
        if (
          before.version !== req.body.version ||
          before.digest !== req.body.digest
        )
          throw new AppError(
            "EDITED_ELSEWHERE",
            "The books changed. Review the year-end figures again.",
            409,
          );
        if (!before.canClose)
          throw new AppError(
            "YEAR_END_BLOCKED",
            before.blockers.join(" "),
            409,
          );
        // Continuous books retain bill allocations and stock lots; no duplicate opening journals are posted.
        await tx
          .update(schema.bookControls)
          .set({ closedThrough: before.to, version: before.version + 1 })
          .where(eq(schema.bookControls.firmId, req.firm.id));
        await tx.insert(schema.bookControlEvents).values({
          id: uuidv7(),
          firmId: req.firm.id,
          action: "close-financial-year",
          reason: req.body.reason,
          userId: req.user.id,
          userName: req.user.name,
          before: { digest: before.digest, year: before.year },
          after: {
            closedThrough: before.to,
            nextFrom: before.nextFrom,
            scopes: before.scopes,
          },
        });
        const result = await yearReview(tx, req.firm.id, req.body.year, true);
        if (idem) await rememberAnswer(tx, req.user.id, idem, 200, result);
        return result;
      });
    },
  );
}
