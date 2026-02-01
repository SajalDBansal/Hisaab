import { NoticeList, NotificationReadInput } from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { notificationsService } from "./notifications.service";

export async function notificationRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/notifications",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: NoticeList } },
    },
    async (req) =>
      notificationsService.list(db, req.firm.id, req.user.id, req.firm.role),
  );

  typed.post(
    "/notifications/read",
    {
      preHandler: app.inFirm(),
      schema: {
        body: NotificationReadInput,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      await notificationsService.markRead(
        db,
        req.firm.id,
        req.user.id,
        req.body.ids,
      );
      return { ok: true as const };
    },
  );
}
