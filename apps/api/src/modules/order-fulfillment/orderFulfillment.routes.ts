import { IdParams } from "@repo/contracts";
import {
  OrderFulfillmentDetail,
  OrderFulfillmentHeaders,
  OrderFulfillmentInput,
  OrderFulfillmentResult,
} from "@repo/contracts/src/orderFulfillment";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { idemOf } from "@repo/backend/modules/vouchers/idempotency";
import type { OrderFulfillmentHooks } from "./orderFulfillment.hooks";
import { orderFulfillmentService } from "./orderFulfillment.service";
import { AppError } from "@repo/backend/lib/app-error";

export async function orderFulfillmentRoutes(
  app: FastifyInstance,
  options: { db: Db; hooks: OrderFulfillmentHooks },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  typed.get(
    "/orders/:id/fulfillment",
    {
      preHandler: app.inFirm(),
      schema: { params: IdParams, response: { 200: OrderFulfillmentDetail } },
    },
    async (req) =>
      orderFulfillmentService.get(
        options.db,
        req.firm.id,
        req.firm.role,
        req.params.id,
      ),
  );
  typed.post(
    "/orders/:id/fulfill",
    {
      preHandler: app.inFirm(["sales", "purchase"]),
      schema: {
        params: IdParams,
        headers: OrderFulfillmentHeaders,
        body: OrderFulfillmentInput,
        response: { 201: OrderFulfillmentResult },
      },
    },
    async (req, reply) => {
      const idem = idemOf(req.headers["idempotency-key"], {
        firmId: req.firm.id,
        route: `/orders/${req.params.id}/fulfill`,
        body: req.body,
      });
      if (!idem)
        throw new AppError(
          "IDEMPOTENCY_REQUIRED",
          "A retry key is required.",
          428,
        );
      return reply.code(201).send(
        await orderFulfillmentService.fulfill(
          options.db,
          {
            firmId: req.firm.id,
            id: req.user.id,
            name: req.user.name,
            role: req.firm.role,
            idem,
          },
          req.params.id,
          req.body,
          options.hooks,
        ),
      );
    },
  );
}
