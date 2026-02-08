import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import {
  RecoveryRedeemInput,
  redeemRecoveryIdentity,
} from "./recovery-operations.service";

// Parent mounts this only on the isolated recovery API. It issues neither tickets nor sessions.
export async function recoveryOperationsRoutes(
  app: FastifyInstance,
  { db }: { db: Db },
) {
  app.addHook("preSerialization", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    return payload;
  });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply
      .header("cache-control", "private, no-store")
      .header("pragma", "no-cache");
    reply.removeHeader("etag");
    return payload;
  });
  app.withTypeProvider<ZodTypeProvider>().post(
    "/recovery-operations/redeem",
    {
      bodyLimit: 2048,
      logLevel: "silent",
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        body: RecoveryRedeemInput,
        response: {
          200: z.object({
            enrolled: z.literal(true),
            signInRequired: z.literal(true),
          }),
        },
      },
    },
    (request) => redeemRecoveryIdentity(db, request.body),
  );
}
