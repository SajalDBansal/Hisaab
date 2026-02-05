import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IdParams } from "@repo/contracts";
import * as c from "@repo/contracts/src/loans";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { loansService, type LoanActor } from "./loans.service";

export async function loanRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const read = app.inFirm(["accounts", "reports"]);
  const write = app.inFirm("accounts");
  const actor = (req: FastifyRequest): LoanActor => {
    const key = req.headers["idempotency-key"];
    const idem = idemOf(typeof key === "string" ? key : undefined, {
      firmId: req.firm.id,
      route: `${req.method} ${req.url} if-match:${req.headers["if-match"] ?? ""}`,
      body: req.body,
    });
    if (!idem)
      throw new AppError(
        "IDEMPOTENCY_REQUIRED",
        "A request key is required.",
        400,
      );
    return {
      firmId: req.firm.id,
      userId: req.user.id,
      userName: req.user.name,
      idem,
    };
  };
  typed.get(
    "/loans",
    {
      preHandler: read,
      schema: { querystring: c.LoanPageQuery, response: { 200: c.LoanPage } },
    },
    (req) => loansService.list(db, req.firm.id, req.query),
  );
  typed.get(
    "/loans/:id",
    {
      preHandler: read,
      schema: { params: IdParams, response: { 200: c.LoanDetail } },
    },
    (req) => loansService.get(db, req.firm.id, req.params.id),
  );
  typed.get(
    "/loans/:id/history",
    {
      preHandler: read,
      schema: {
        params: IdParams,
        querystring: c.LoanPageQuery,
        response: { 200: c.LoanHistoryPage },
      },
    },
    (req) => loansService.history(db, req.firm.id, req.params.id, req.query),
  );
  typed.get(
    "/loans/:id/repayment-journals",
    {
      preHandler: read,
      schema: {
        params: IdParams,
        querystring: c.LoanPageQuery,
        response: { 200: c.LoanCandidatePage },
      },
    },
    (req) => loansService.candidates(db, req.firm.id, req.params.id, req.query),
  );
  typed.post(
    "/loans",
    {
      preHandler: write,
      schema: {
        headers: c.LoanWriteHeaders,
        body: c.LoanInput,
        response: { 201: c.LoanRecord },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await loansService.create(db, actor(req), req.body)),
  );
  typed.post(
    "/loans/:id/update",
    {
      preHandler: write,
      schema: {
        headers: c.LoanEditHeaders,
        params: IdParams,
        body: c.LoanUpdate,
        response: { 200: c.LoanRecord },
      },
    },
    (req) =>
      loansService.update(
        db,
        actor(req),
        req.params.id,
        Number(req.headers["if-match"]),
        req.body,
      ),
  );
  typed.post(
    "/loans/:id/references",
    {
      preHandler: write,
      schema: {
        headers: c.LoanEditHeaders,
        params: IdParams,
        body: c.LoanReferenceInput,
        response: { 201: c.LoanRecord },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await loansService.addReference(
            db,
            actor(req),
            req.params.id,
            Number(req.headers["if-match"]),
            req.body,
          ),
        ),
  );
  typed.post(
    "/loans/:id/references/:referenceId/remove",
    {
      preHandler: write,
      schema: {
        headers: c.LoanEditHeaders,
        params: c.LoanReferenceParams,
        body: c.LoanReferenceRemoval,
        response: { 200: c.LoanRecord },
      },
    },
    (req) =>
      loansService.removeReference(
        db,
        actor(req),
        req.params.id,
        req.params.referenceId,
        Number(req.headers["if-match"]),
        req.body.reason,
      ),
  );
}
