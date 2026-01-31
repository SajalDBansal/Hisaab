import {
  SyncChanges,
  SyncPullQuery,
  SyncPushInput,
  SyncPushResult,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Db } from "@repo/backend/db/client";
import { syncService } from "./sync.service";

export async function syncRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/sync/changes",
    {
      preHandler: app.inFirm(),
      schema: {
        querystring: SyncPullQuery,
        response: { 200: SyncChanges },
      },
    },
    async (req) => syncService.pull(db, req.firm.id, req.query, req.firm.role),
  );

  typed.post(
    "/sync/push",
    {
      preHandler: app.inFirm(),
      schema: {
        body: SyncPushInput,
        response: { 200: SyncPushResult },
      },
    },
    async (req) =>
      syncService.push(
        db,
        {
          firmId: req.firm.id,
          userId: req.user.id,
          userName: req.user.name,
          role: req.firm.role,
        },
        req.body.mutations,
      ),
  );
}
