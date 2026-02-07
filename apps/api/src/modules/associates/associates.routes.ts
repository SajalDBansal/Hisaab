import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IdParams } from "@repo/contracts";
import * as c from "@repo/contracts/src/associates";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import { associatesService as service } from "./associates.service";
import type { AssociateActor } from "./associates.shared";

export async function associateRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const access = [
    ...app.inFirm(),
    async (req: FastifyRequest) => {
      if (!["owner", "accountant"].includes(req.firm.role))
        throw new AppError(
          "FORBIDDEN",
          "Only an owner or accountant can access associate accounts.",
          403,
        );
    },
  ];
  const actor = (req: FastifyRequest): AssociateActor => {
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
    "/associates/options",
    {
      preHandler: app.inFirm(["sales", "accounts"]),
      schema: { response: { 200: z.array(c.AssociateOption) } },
    },
    (req) => service.options(db, req.firm.id),
  );
  typed.get(
    "/associates/fields",
    {
      preHandler: access,
      schema: { response: { 200: z.array(c.AssociateField) } },
    },
    (req) => service.fields(db, req.firm.id),
  );
  typed.post(
    "/associates/fields",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateWriteHeaders,
        body: c.AssociateFieldInput,
        response: { 201: c.AssociateField },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await service.saveField(db, actor(req), req.body)),
  );
  typed.post(
    "/associates/fields/:id/update",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateEditHeaders,
        params: IdParams,
        body: c.AssociateFieldInput,
        response: { 200: c.AssociateField },
      },
    },
    (req) =>
      service.saveField(
        db,
        actor(req),
        req.body,
        req.params.id,
        Number(req.headers["if-match"]),
      ),
  );
  typed.get(
    "/associates",
    {
      preHandler: access,
      schema: {
        querystring: c.AssociatePageQuery,
        response: { 200: c.AssociatePage },
      },
    },
    (req) => service.list(db, req.firm.id, req.query),
  );
  typed.get(
    "/associates/:id",
    {
      preHandler: access,
      schema: { params: IdParams, response: { 200: c.AssociateDetail } },
    },
    (req) => service.get(db, req.firm.id, req.params.id),
  );
  typed.get(
    "/associates/:id/statement",
    {
      preHandler: access,
      schema: {
        params: IdParams,
        querystring: c.AssociateStatementQuery,
        response: { 200: c.AssociateStatement },
      },
    },
    (req) => service.statement(db, req.firm.id, req.params.id, req.query),
  );
  typed.post(
    "/associates",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateWriteHeaders,
        body: c.AssociateInput,
        response: { 201: c.AssociateRecord },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await service.create(db, actor(req), req.body)),
  );
  typed.post(
    "/associates/:id/update",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateEditHeaders,
        params: IdParams,
        body: c.AssociateUpdate,
        response: { 200: c.AssociateRecord },
      },
    },
    (req) =>
      service.update(
        db,
        actor(req),
        req.params.id,
        Number(req.headers["if-match"]),
        req.body,
      ),
  );
  typed.post(
    "/associates/deliveries/:id/update",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateEditHeaders,
        params: IdParams,
        body: c.DeliveryUpdate,
        response: { 200: c.DeliveryAssignment },
      },
    },
    (req) =>
      service.updateDelivery(
        db,
        actor(req),
        req.params.id,
        Number(req.headers["if-match"]),
        req.body,
      ),
  );
  typed.post(
    "/associates/:id/payouts",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateEditHeaders,
        params: IdParams,
        body: c.AssociatePayoutInput,
        response: { 201: c.AssociatePayout },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(
          await service.payout(
            db,
            actor(req),
            req.params.id,
            Number(req.headers["if-match"]),
            req.body,
          ),
        ),
  );
  typed.post(
    "/associates/payouts/:id/reverse",
    {
      preHandler: access,
      schema: {
        headers: c.AssociateEditHeaders,
        params: IdParams,
        body: c.AssociatePayoutReversal,
        response: { 200: c.AssociatePayout },
      },
    },
    (req) =>
      service.reversePayout(
        db,
        actor(req),
        req.params.id,
        Number(req.headers["if-match"]),
        req.body,
      ),
  );
}
