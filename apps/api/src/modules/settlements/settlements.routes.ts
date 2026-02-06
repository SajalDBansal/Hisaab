import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IdParams } from "@repo/contracts";
import * as c from "@repo/contracts/src/settlements";
import type { Db } from "@repo/backend/db/client";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { settlementsService } from "./settlements.service";
import { invalid, type SettlementActor } from "@repo/backend/modules/settlements/settlements.shared";
import { postLoanInterest } from "./interest.service";
import { approveSaleCredit } from "./credit.service";
import { approveOrderCredit } from "./orderCredit.service";

export async function settlementRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const read = app.inFirm(["accounts", "reports"]),
    write = app.inFirm("accounts");
  const actor = (req: FastifyRequest): SettlementActor => {
    const key = req.headers["idempotency-key"];
    const idem = idemOf(typeof key === "string" ? key : undefined, {
      firmId: req.firm.id,
      route: `${req.method} ${req.url}`,
      body: req.body,
    });
    if (!idem)
      invalid("A request key is required.", "IDEMPOTENCY_REQUIRED", 400);
    return {
      firmId: req.firm.id,
      userId: req.user.id,
      userName: req.user.name,
      idem,
    };
  };
  typed.get(
    "/settlements",
    {
      preHandler: read,
      schema: {
        querystring: c.SettlementQuery,
        response: { 200: c.SettlementPage },
      },
    },
    (req) => settlementsService.list(db, req.firm.id, req.query),
  );
  typed.get(
    "/settlements/context",
    {
      preHandler: read,
      schema: {
        querystring: c.SettlementContextQuery,
        response: { 200: c.SettlementContext },
      },
    },
    (req) => settlementsService.context(db, req.firm.id, req.query),
  );
  typed.get(
    "/settlements/:id",
    {
      preHandler: read,
      schema: { params: IdParams, response: { 200: c.SettlementRecord } },
    },
    (req) => settlementsService.get(db, req.firm.id, req.params.id),
  );
  typed.post(
    "/settlements",
    {
      preHandler: write,
      schema: {
        headers: c.SettlementWriteHeaders,
        body: c.SettlementInput,
        response: { 201: c.SettlementRecord },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await settlementsService.create(db, actor(req), req.body)),
  );
  typed.post(
    "/settlements/:id/reverse",
    {
      preHandler: write,
      schema: {
        headers: c.SettlementWriteHeaders,
        params: IdParams,
        body: c.SettlementReverseInput,
        response: { 201: c.SettlementRecord },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await settlementsService.reverse(
            db,
            actor(req),
            req.params.id,
            req.body,
          ),
        ),
  );
  typed.post(
    "/settlements/loan-interest",
    {
      preHandler: write,
      schema: {
        headers: c.SettlementWriteHeaders,
        body: c.LoanInterestInput,
        response: { 201: c.SettlementRecord },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await postLoanInterest(db, actor(req), req.body)),
  );
  typed.post(
    "/settlements/credit-approvals",
    {
      preHandler: write,
      schema: {
        headers: c.SettlementWriteHeaders,
        body: c.CreditApprovalInput,
        response: { 201: c.CreditApproval },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await approveSaleCredit(db, actor(req), req.body)),
  );
  typed.post(
    "/settlements/order-credit-approvals",
    {
      preHandler: write,
      schema: {
        headers: c.SettlementWriteHeaders,
        body: c.OrderCreditApprovalInput,
        response: { 201: c.CreditApproval },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await approveOrderCredit(db, actor(req), req.body)),
  );
}
