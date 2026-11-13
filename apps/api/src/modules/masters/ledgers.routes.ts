import {
  IdParams,
  LedgerInput,
  LedgerListParams,
  LedgerRow,
  LedgerStatement,
  StatementQuery,
  AsOfQuery,
  ReconciliationView,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { ledgerForRead } from "../../lib/read-permissions";
import { ledgersRepo } from "./ledgers.repo";
import { ledgersService, toLedgerRow } from "./ledgers.service";
import {
  expectedVersion,
  notFound,
} from "@repo/backend/modules/masters/shared";
import { readLedgerStatement } from "./views.service";
import { bankReconciliation, today } from "@repo/core";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { createListCache, listKey, statementPage } from "../../lib/list-cache";

/** Receipt selectors remain available; statements and balances require access to books. */
export async function ledgerRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  // Later pages of a statement reuse it instead of re-reading the books.
  const statements = createListCache();
  const write = app.inFirm("payments");
  typed.get(
    "/ledgers/:id/reconciliation",
    {
      preHandler: app.inFirm(["payments", "reports"]),
      schema: {
        params: IdParams,
        querystring: AsOfQuery,
        response: { 200: ReconciliationView },
      },
    },
    async (req) => {
      const books = await db.transaction(
        (tx) => loadReportBooks(tx, req.firm.id),
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
      const ledger = books.ledgers.find(
        (l) => l.id === req.params.id && l.kind === "bank",
      );
      if (!ledger) throw notFound("bank");
      const asOf = req.query.asOf ?? today();
      return {
        ledger,
        asOf,
        ...bankReconciliation(ledger, books.vouchers, asOf),
      };
    },
  );

  typed.get(
    "/ledgers/:id/statement",
    {
      preHandler: app.inFirm(["payments", "reports"]),
      schema: {
        params: IdParams,
        querystring: StatementQuery,
        response: { 200: LedgerStatement },
      },
    },
    async (req) =>
      statementPage(
        await statements(
          listKey(req, `ledger:${req.params.id}:${req.query.tax}`),
          () =>
            readLedgerStatement(db, req.firm.id, req.params.id, req.query.tax),
        ),
        req.query,
      ),
  );

  typed.get(
    "/ledgers",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: LedgerListParams,
        response: { 200: z.array(LedgerRow) },
      },
    },
    async (req) =>
      (await ledgersRepo.list(db, req.firm.id, req.query.kind)).map((row) =>
        ledgerForRead(req.firm.role, toLedgerRow(row)),
      ),
  );

  typed.get(
    "/ledgers/:id",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: LedgerRow } },
    },
    async (req) => {
      const row = await ledgersRepo.get(db, req.firm.id, req.params.id);
      if (!row) throw notFound("account");
      return ledgerForRead(req.firm.role, toLedgerRow(row));
    },
  );

  typed.post(
    "/ledgers",
    {
      preHandler: write,
      schema: { body: LedgerInput, response: { 201: LedgerRow } },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await ledgersService.create(db, req.firm.id, req.body)),
  );

  typed.put(
    "/ledgers/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        body: LedgerInput,
        response: { 200: LedgerRow },
      },
    },
    async (req) =>
      ledgersService.update(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
        req.body,
      ),
  );

  typed.delete(
    "/ledgers/:id",
    {
      preHandler: write,
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await ledgersService.remove(
        db,
        req.firm.id,
        req.params.id,
        expectedVersion(req.headers["if-match"]),
      );
      return { ok: true as const };
    },
  );
}
