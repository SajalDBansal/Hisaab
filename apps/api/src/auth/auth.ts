import { normalizeMobile } from "@repo/contracts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { emailOTP, organization } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import type { Env } from "../config/env";
import { schema, type Db } from "@repo/backend/db/client";
import type { EmailSender } from "../lib/email";
import { maskEmail } from "../lib/mask";
import { firmAccess } from "./access";
import { endOtherSessions, readClient, tokenFromCookie } from "./sessionRules";
import { safeError } from "@repo/backend/lib/safe-error";
import { authLogger } from "./logging";

export interface AuthDeps {
  env: Pick<Env, "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "TRUSTED_ORIGINS">;
  db: Db;
  email: EmailSender;
  log: { error: (obj: object, message: string) => void };
}

/** The whole login system: sign-up, email codes, passwords and sessions. */
export function createAuth({ env, db, email, log }: AuthDeps) {
  // Codes are sent in the background so a slow email service can't be used to guess which emails exist
  const sendInvite = (data: Parameters<EmailSender["sendInvite"]>[1]) => {
    email
      .sendInvite(data.to, data)
      .catch((err: unknown) =>
        log.error(
          { err: safeError(err), to: maskEmail(data.to) },
          "Could not send invitation",
        ),
      );
  };

  const sendInBackground = (
    to: string,
    code: string,
    purpose: Parameters<EmailSender["sendCode"]>[2],
  ) => {
    email
      .sendCode(to, code, purpose)
      .catch((err: unknown) =>
        log.error(
          { err: safeError(err), to: maskEmail(to) },
          "Could not send code",
        ),
      );
  };

  return betterAuth({
    appName: "Hisaab",
    logger: authLogger(log),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS,
    rateLimit: {
      // Fastify owns password signin limits by normalized account and IP.
      customRules: { "/sign-in/email": false },
    },
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: {
      cookiePrefix: "hisaab",
      // Firm tables point at these ids, so they are UUIDs like everything else
      database: { generateId: "uuid" },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // A new password logs out every other device
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    },

    user: {
      additionalFields: {
        // Saved at sign-up. Checking it by WhatsApp comes later; until then it stays "not verified".
        phoneNumber: { type: "string", required: true },
        phoneNumberVerified: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      additionalFields: {
        platform: {
          type: "string",
          required: false,
          defaultValue: "app",
          input: false,
        },
        deviceName: { type: "string", required: false, input: false },
        lastActiveAt: { type: "date", required: false, input: false },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const phone = normalizeMobile(
              String((user as { phoneNumber?: string }).phoneNumber ?? ""),
            );
            if (!phone)
              throw new APIError("BAD_REQUEST", {
                code: "INVALID_MOBILE",
                message: "Enter a 10-digit Indian mobile number.",
              });
            const taken = await ctx?.context.adapter.findOne({
              model: "user",
              where: [{ field: "phoneNumber", value: phone }],
            });
            if (taken)
              throw new APIError("BAD_REQUEST", {
                code: "PHONE_TAKEN",
                message: "This mobile number is already registered.",
              });
            return { data: { ...user, phoneNumber: phone } };
          },
        },
      },
      session: {
        create: {
          // Runs only after the password was right, so it is safe to tell the caller about the other device
          before: async (session, ctx) => {
            const client = readClient(ctx?.headers);
            const currentToken = tokenFromCookie(ctx?.headers?.get("cookie"));
            const mine = await ctx?.context.internalAdapter.listSessions(
              session.userId,
            );
            const open = (mine ?? []).filter(
              (s) =>
                (s as { platform?: string }).platform === client.platform &&
                s.token !== currentToken &&
                new Date(s.expiresAt) > new Date(),
            );
            // Sent as a header because Better Auth drops body fields it does not know
            const confirmed =
              ctx?.headers?.get("x-confirm-takeover") === "true";
            const other = open[0] as
              | {
                  deviceName?: string | null;
                  lastActiveAt?: Date | null;
                  createdAt: Date;
                }
              | undefined;
            if (other && !confirmed)
              throw new APIError("CONFLICT", {
                code: "ACTIVE_ELSEWHERE",
                message: "You are already logged in on another device.",
                deviceName: other.deviceName ?? null,
                lastActiveAt: new Date(
                  other.lastActiveAt ?? other.createdAt,
                ).toISOString(),
              });
            return {
              data: {
                ...session,
                platform: client.platform,
                deviceName: client.deviceName,
                lastActiveAt: new Date(),
              },
            };
          },
          // Better Auth awaits this hook before issuing the sign-in cookie.
          after: async (session, ctx) => {
            if (ctx && !(await endOtherSessions(db, ctx, session)))
              throw new APIError("CONFLICT", {
                code: "SESSION_REPLACED",
                message:
                  "Another login replaced this session. Continue on the other device.",
              });
          },
        },
      },
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email: to, otp, type }) =>
          sendInBackground(to, otp, type),
      }),
      // Firms. Firms are created by our own route (it also sets up the books), so Better Auth's
      // create/delete are off; it handles members, invitations and role checks.
      organization({
        ...firmAccess,
        creatorRole: "owner",
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        invitationLimit: 50,
        membershipLimit: 50,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data) =>
          sendInvite({
            to: data.email,
            firmName: data.organization.name,
            inviterName: data.inviter.user.name,
            role: data.role,
          }),
      }),
      expo(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
