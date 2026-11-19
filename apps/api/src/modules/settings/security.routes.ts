import { FirmSecurity, FirmSecurityView } from "@repo/contracts";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { publishLive } from "@repo/backend/lib/live";
import { loadFirmSecurity } from "@repo/backend/modules/firmSecurity/firmSecurity.repo";
import { expectedVersion } from "@repo/backend/modules/masters/shared";

/**
 * Firm security (doc 37, T58): the owner can require two-factor sign-in from
 * every member. `app.inFirm` enforces it on every firm route.
 */
export async function securityRoutes(
  app: FastifyInstance,
  options: { db: Db },
) {
  const { db } = options;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/settings/security",
    {
      preHandler: app.inFirm(),
      schema: { response: { 200: FirmSecurityView } },
    },
    async (req) => loadFirmSecurity(db, req.firm.id),
  );

  typed.put(
    "/settings/security",
    {
      preHandler: app.inFirm("settings"),
      schema: { body: FirmSecurity, response: { 200: FirmSecurityView } },
    },
    async (req) => {
      if (req.firm.role !== "owner")
        throw new AppError(
          "FORBIDDEN",
          "Only the owner of the firm can change who must use two-factor sign-in.",
          403,
        );
      // No lock-out: the owner proves it works for them before requiring it.
      if (req.body.requireTwoFactor && !req.user.twoFactorEnabled)
        throw new AppError(
          "TWO_FACTOR_SETUP_FIRST",
          "Turn on two-factor sign-in for your own account first (Settings → Account).",
          409,
        );
      const version = expectedVersion(req.headers["if-match"]);
      const saved = await withFirmWrite(db, req.firm.id, async (tx) => {
        const current = await loadFirmSecurity(tx, req.firm.id);
        if (current.version !== version)
          throw new AppError(
            "EDITED_ELSEWHERE",
            "Someone changed the firm's security settings. Reload and try again.",
            409,
          );
        await tx
          .insert(schema.firmSecurity)
          .values({ firmId: req.firm.id, ...req.body })
          .onConflictDoUpdate({
            target: schema.firmSecurity.firmId,
            set: {
              ...req.body,
              version: sql`${schema.firmSecurity.version} + 1`,
              updatedAt: new Date(),
            },
          });
        return loadFirmSecurity(tx, req.firm.id);
      });
      // Members without two-factor lose their live connection to this firm now.
      if (saved.requireTwoFactor) {
        const blocked = await db
          .select({ userId: schema.member.userId })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(
            and(
              eq(schema.member.organizationId, req.firm.id),
              eq(schema.user.twoFactorEnabled, false),
            ),
          );
        for (const m of blocked)
          await publishLive(db, {
            t: "access",
            f: req.firm.id,
            u: m.userId,
          }).catch(() => undefined);
      }
      return saved;
    },
  );
}
