import {
  IdParams,
  Me,
  MeUpdate,
  SessionInfo,
  TwoFactorStatus,
} from "@repo/contracts";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "../../auth/auth";
import { viaAuth } from "../../lib/auth-call";
import { and, desc, eq, gt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";

/** The logged-in person: their details and the devices they are logged in on. */
export async function meRoutes(
  app: FastifyInstance,
  options: { db: Db; auth: Auth },
) {
  const { db, auth: betterAuth } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const auth = { preHandler: app.authenticate };

  const toMe = (u: typeof schema.user.$inferSelect): z.infer<typeof Me> => ({
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    phoneNumber: u.phoneNumber,
    phoneVerified: u.phoneNumberVerified,
    twoFactorEnabled: u.twoFactorEnabled,
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

  // ---- Two-factor sign-in (doc 37, T58) ---------------------------------
  // Turning it on/off and new recovery codes go through Better Auth's own
  // routes (/api/auth/two-factor/*); these two only read.

  const recoveryCodes = async (userId: string) => {
    const found = await viaAuth(() =>
      betterAuth.api.viewBackupCodes({ body: { userId } }),
    );
    return found.backupCodes;
  };

  typed.get(
    "/me/two-factor",
    { ...auth, schema: { response: { 200: TwoFactorStatus } } },
    async (req) => {
      const enabled = req.user.twoFactorEnabled === true;
      return {
        enabled,
        recoveryCodesLeft: enabled
          ? (await recoveryCodes(req.user.id)).length
          : 0,
      };
    },
  );

  // Shows the unused recovery codes again; the password is asked first.
  typed.post(
    "/me/two-factor/recovery-codes",
    {
      ...auth,
      schema: {
        body: z.object({ password: z.string().min(1).max(128) }),
        response: { 200: z.object({ codes: z.array(z.string()) }) },
      },
    },
    async (req) => {
      if (req.user.twoFactorEnabled !== true)
        throw new AppError(
          "TWO_FACTOR_NOT_ENABLED",
          "Two-factor sign-in is not on for this account.",
          400,
        );
      await viaAuth(() =>
        betterAuth.api.verifyPassword({
          headers: fromNodeHeaders(req.headers),
          body: { password: req.body.password },
        }),
      );
      return { codes: await recoveryCodes(req.user.id) };
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
