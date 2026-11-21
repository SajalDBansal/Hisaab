import {
  FirmPresence,
  LiveTicket,
  Role,
  type LiveDevice,
} from "@repo/contracts";
import { type Db, schema } from "@repo/backend/db/client";
import { issueLiveTicket } from "@repo/backend/lib/live";
import { firmPresence } from "@repo/backend/lib/live-presence";
import type { RedisClient } from "@repo/backend/lib/redis";
import { asc, eq, inArray, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

const toRole = (value: string | null) => Role.safeParse(value).data ?? "viewer";

/**
 * The API's half of live updates. The live service is a separate process; it
 * trusts only passes signed here, so it never needs the session cookie.
 */
export async function liveRoutes(
  app: FastifyInstance,
  options: {
    db: Db;
    redis?: RedisClient;
    live?: { secret: string; url: string };
  },
) {
  const { db, redis, live } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  /** A one-time pass, valid for a minute, for the caller's session and open firm. */
  typed.post(
    "/live/ticket",
    {
      preHandler: app.inFirm(),
      config: { readOnly: true },
      schema: { response: { 200: LiveTicket } },
    },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      if (!live) return { enabled: false as const };
      const pass = issueLiveTicket(live.secret, {
        userId: req.user.id,
        sessionId: req.session.id,
        firmId: req.firm.id,
      });
      return { enabled: true as const, url: live.url, ...pass };
    },
  );

  /** Who is online now, on which devices, and when each person was last active. */
  typed.get(
    "/firms/current/presence",
    {
      preHandler: app.inFirm("team"),
      schema: { response: { 200: FirmPresence } },
    },
    async (req, reply) => {
      reply.header("cache-control", "private, no-store");
      const members = await db
        .select({
          memberId: schema.member.id,
          userId: schema.member.userId,
          name: schema.user.name,
          role: schema.member.role,
        })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.member.organizationId, req.firm.id))
        .orderBy(asc(schema.member.createdAt));
      const userIds = members.map((m) => m.userId);
      const lastActive = userIds.length
        ? await db
            .select({
              userId: schema.session.userId,
              at: max(schema.session.lastActiveAt),
            })
            .from(schema.session)
            .where(inArray(schema.session.userId, userIds))
            .groupBy(schema.session.userId)
        : [];
      let connections: Awaited<ReturnType<typeof firmPresence>> = [];
      if (redis)
        try {
          connections = await firmPresence(redis, req.firm.id);
        } catch (error) {
          req.log.warn({ err: error }, "Presence could not be read");
        }
      return {
        members: members.map((m) => {
          const devices: LiveDevice[] = connections
            .filter((c) => c.userId === m.userId)
            .map((c) => ({
              platform: c.platform,
              device: c.device,
              since: c.since,
            }));
          const at = lastActive.find((row) => row.userId === m.userId)?.at;
          return {
            ...m,
            role: toRole(m.role),
            online: devices.length > 0,
            devices,
            lastActiveAt: at ? new Date(at).toISOString() : null,
          };
        }),
      };
    },
  );
}
