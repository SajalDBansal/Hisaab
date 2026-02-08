import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import type { Db } from "@repo/backend/db/client";
import { account, session, user } from "@repo/backend/db/schema/auth";
import { recoveryIdentityTickets as tickets } from "@repo/backend/db/schema/recoveryOperations";
import { AppError } from "@repo/backend/lib/app-error";

export const RecoveryRedeemInput = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    email: z.string().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();

export function recoveryTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const unavailable = () =>
  new AppError(
    "RECOVERY_UNAVAILABLE",
    "This recovery authorization is unavailable or expired.",
    400,
  );

export async function redeemRecoveryIdentity(
  db: Db,
  input: z.infer<typeof RecoveryRedeemInput>,
) {
  const parsed = RecoveryRedeemInput.parse(input);
  // Use exactly the authentication library's password format, never a parallel credential scheme.
  const password = await hashPassword(parsed.password);
  return db
    .transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '15s'`);
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.tokenHash, recoveryTokenHash(parsed.token)))
        .for("update");
      if (
        !ticket ||
        ticket.consumedAt ||
        ticket.expiresAt <= new Date() ||
        ticket.email !== parsed.email
      )
        throw unavailable();
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`recovery-identity:${ticket.userId}`}, 0))`,
      );
      const [identity] = await tx
        .select()
        .from(user)
        .where(eq(user.id, ticket.userId))
        .for("update");
      if (!identity || identity.email !== ticket.email) throw unavailable();
      if (
        (
          await tx
            .select({ id: account.id })
            .from(account)
            .where(eq(account.userId, identity.id))
            .limit(1)
        ).length ||
        (
          await tx
            .select({ id: session.id })
            .from(session)
            .where(eq(session.userId, identity.id))
            .limit(1)
        ).length
      )
        throw unavailable();
      if (ticket.expiresAt <= new Date()) throw unavailable();
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: identity.id,
        providerId: "credential",
        userId: identity.id,
        password,
      });
      // Issuance requires witnessed verification of this exact mailbox/person. The one-use secret is delivered there separately.
      await tx
        .update(user)
        .set({
          emailVerified: true,
          phoneNumberVerified: false,
          updatedAt: new Date(),
        })
        .where(eq(user.id, identity.id));
      await tx
        .update(tickets)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(tickets.id, ticket.id),
            eq(tickets.tokenHash, recoveryTokenHash(parsed.token)),
          ),
        );
      return { enrolled: true as const, signInRequired: true as const };
    })
    .catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      // Database driver errors can contain bound credential parameters. Never expose them to logging/reporting hooks.
      throw new AppError(
        "RECOVERY_UNAVAILABLE",
        "Recovery is temporarily unavailable. Keep this environment isolated.",
        503,
      );
    });
}
