import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { createOperationEngine } from "./operations.engine";
import { operationRepository } from "./operations.repo";
import {
  OperationInput,
  OperationParams,
  OperationResult,
} from "./operations.schema";
import { UploadRequest } from "@repo/contracts";
import {
  lookupDocumentReservation,
  ReservationAnswer,
} from "./operations.documents";

export async function operationRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    return payload;
  });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const service = createOperationEngine(operationRepository(db));
  typed.post(
    "/operations/:key/document-reservation",
    {
      preHandler: app.inFirm([
        "sales",
        "purchase",
        "payments",
        "accounts",
        "settings",
      ]),
      schema: {
        params: OperationParams,
        body: UploadRequest,
        response: { 200: ReservationAnswer },
      },
    },
    (request) =>
      lookupDocumentReservation(
        db,
        {
          id: request.user.id,
          name: request.user.name,
          firmId: request.firm.id,
          role: request.firm.role,
        },
        request.params.key,
        request.body,
      ),
  );
  for (const [suffix, action] of [
    ["", "execute"],
    ["/lookup", "lookup"],
    ["/cancel", "cancel"],
  ] as const) {
    typed.post(
      `/operations/:key${suffix}`,
      {
        preHandler: app.inFirm(),
        schema: {
          params: OperationParams,
          body: OperationInput,
          response: { 200: OperationResult },
        },
      },
      (request) =>
        service[action](
          {
            id: request.user.id,
            name: request.user.name,
            firmId: request.firm.id,
            role: request.firm.role,
          },
          request.params.key,
          request.body,
        ),
    );
  }
}
