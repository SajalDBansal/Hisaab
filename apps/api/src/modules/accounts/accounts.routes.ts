import {
  AccountInfo,
  AccountParams,
  AccountStatement,
  ChartGroup,
  AccountInput,
  CustomAccount,
  StatementQuery,
  StockSummaryQuery,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { accountsService } from "./accounts.service";
import {
  createAccount,
  listAccounts,
} from "@repo/backend/modules/accounts/accountMasters";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { createListCache, listKey, statementPage } from "../../lib/list-cache";

export async function accountRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  // Later pages of a statement reuse it instead of re-reading the books.
  const statements = createListCache();
  const read = app.inFirm(["accounts", "reports"]);

  typed.get(
    "/accounts/masters",
    {
      preHandler: read,
      schema: { response: { 200: z.array(CustomAccount) } },
    },
    async (req) => listAccounts(db, req.firm.id),
  );

  typed.post(
    "/accounts/masters",
    {
      preHandler: app.inFirm("accounts"),
      schema: { body: AccountInput, response: { 201: CustomAccount } },
    },
    async (req, reply) => {
      const key = req.headers["idempotency-key"];
      const idem = idemOf(typeof key === "string" ? key : undefined, {
        firmId: req.firm.id,
        route: "/accounts/masters",
        body: req.body,
      });
      return reply
        .code(201)
        .send(
          await createAccount(db, req.firm.id, req.user.id, req.body, idem),
        );
    },
  );

  typed.get(
    "/accounts/chart",
    {
      preHandler: read,
      schema: {
        querystring: StockSummaryQuery,
        response: { 200: z.array(ChartGroup) },
      },
    },
    async (req) => accountsService.chart(db, req.firm.id, req.query.tax),
  );

  typed.get(
    "/accounts",
    {
      preHandler: read,
      schema: { response: { 200: z.array(AccountInfo) } },
    },
    async (req) => accountsService.pickable(db, req.firm.id),
  );

  typed.get(
    "/accounts/:key/statement",
    {
      preHandler: read,
      schema: {
        params: AccountParams,
        querystring: StatementQuery,
        response: { 200: AccountStatement },
      },
    },
    async (req) =>
      statementPage(
        await statements(
          listKey(req, `account:${req.params.key}:${req.query.tax}`),
          () =>
            accountsService.statement(
              db,
              req.firm.id,
              req.params.key,
              req.query.tax,
            ),
        ),
        req.query,
      ),
  );
}
