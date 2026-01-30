import { IdParams, Me, MeUpdate, SessionInfo } from "@repo/contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";

/** The logged-in person: their details and the devices they are logged in on. */
export async function meRoutes(app: FastifyInstance, options: { db: Db }) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  const toMe = (u: typeof schema.user.$inferSelect): z.infer<typeof Me> => ({
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    phoneNumber: u.phoneNumber,
    phoneVerified: u.phoneNumberVerified,
    createdAt: u.createdAt.toISOString(),
  });

  typed.get(
    "/me",
    { ...auth, schema: { response: { 200: Me } } },
    async (req) => {
      const [row] = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, req.user.id));
      if (!row)
        throw new AppError(
          "UNAUTHENTICATED",
          "Please log in to continue.",
          401,
        );
      return toMe(row);
    },
  );

  typed.patch(
    "/me",
    { ...auth, schema: { body: MeUpdate, response: { 200: Me } } },
    async (req) => {
      const [row] = await db
        .update(schema.user)
        .set({ name: req.body.name, updatedAt: new Date() })
        .where(eq(schema.user.id, req.user.id))
        .returning();
      if (!row)
        throw new AppError(
          "UNAUTHENTICATED",
          "Please log in to continue.",
          401,
        );
      return toMe(row);
    },
  );

  typed.get(
    "/me/sessions",
    { ...auth, schema: { response: { 200: z.array(SessionInfo) } } },
    async (req) => {
      const rows = await db
        .select()
        .from(schema.session)
        .where(
          and(
            eq(schema.session.userId, req.user.id),
            gt(schema.session.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schema.session.lastActiveAt));
      return rows.map((s) => ({
        id: s.id,
        platform: s.platform,
        deviceName: s.deviceName,
        lastActiveAt: s.lastActiveAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        current: s.id === req.session.id,
      }));
    },
  );

  typed.delete(
    "/me/sessions/:id",
    { ...auth, schema: { params: IdParams, response: { 204: z.null() } } },
    async (req, reply) => {
      const removed = await db
        .delete(schema.session)
        .where(
          and(
            eq(schema.session.id, req.params.id),
            eq(schema.session.userId, req.user.id),
          ),
        )
        .returning({ id: schema.session.id });
      if (removed.length === 0)
        throw new AppError("NOT_FOUND", "That device isn't logged in.", 404);
      return reply.code(204).send(null);
    },
  );
}
