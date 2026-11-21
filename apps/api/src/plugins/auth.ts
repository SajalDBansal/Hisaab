import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { confirmTwoFactorCode } from "../auth/twoFactorCode";
import type { Auth } from "../auth/auth";
import { tokenFromCookie, wasReplaced } from "../auth/sessionRules";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { deviceLabel, setOriginDevice } from "@repo/backend/lib/request-origin";

type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `app.authenticate`: who is calling. */
    user: Session["user"];
    session: Session["session"];
  }
  interface FastifyInstance {
    /** Use as `preHandler`: replies 401 unless a valid session came with the request. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const FIVE_MINUTES = 5 * 60 * 1000;
// Better Auth's enabled OTP send routes all share the same normalized email quota.
// The email-otp plugin also overrides /send-verification-email to send a code.
const EMAIL_CODE_SEND_PATHS = new Set([
  "/api/auth/sign-up/email",
  "/api/auth/send-verification-email",
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/email-otp/request-password-reset",
  "/api/auth/forget-password/email-otp",
]);
// Two-factor codes (doc 37, T58): sign-in challenges, turning it on, and turning it off.
const TWO_FACTOR_CODE_PATHS = new Set([
  "/api/auth/two-factor/verify-totp",
  "/api/auth/two-factor/verify-backup-code",
  "/api/auth/two-factor/verify-otp",
  "/api/auth/two-factor/disable",
]);
const CODE_VERIFY_PATHS = new Set([
  "/api/auth/email-otp/verify-email",
  "/api/auth/email-otp/reset-password",
]);

/** Mounts Better Auth at /api/auth/* and adds `app.authenticate`. */
export async function registerAuth(app: FastifyInstance, auth: Auth, db: Db) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (req, reply) => {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      // Match Better Auth's normalizePathname before applying endpoint limits.
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      if (!(await app.checkAuthRateLimit(req, reply))) return reply;
      if (
        req.method === "POST" &&
        EMAIL_CODE_SEND_PATHS.has(pathname) &&
        !(await app.checkEmailCodeLimit(req, reply))
      )
        return reply;
      if (
        req.method === "POST" &&
        CODE_VERIFY_PATHS.has(pathname) &&
        !(await app.checkCodeVerifyLimit(req, reply))
      )
        return reply;
      if (
        req.method === "POST" &&
        pathname === "/api/auth/sign-in/email" &&
        !(await app.checkPasswordLoginLimit(req, reply))
      )
        return reply;
      if (
        req.method === "POST" &&
        TWO_FACTOR_CODE_PATHS.has(pathname) &&
        !(await app.checkTwoFactorLimit(req, reply))
      )
        return reply;
      let body = req.body as Record<string, unknown> | undefined;
      if (
        req.method === "POST" &&
        pathname.startsWith("/api/auth/two-factor/")
      ) {
        // Trusted devices are not offered: every sign-in asks for the code.
        if (body && typeof body === "object") {
          const { trustDevice: _skip, ...rest } = body;
          body = rest;
        }
        // Turning two-factor off needs a code from the app (or a recovery code) as
        // well as the password, so a stolen password alone can't remove it.
        if (pathname === "/api/auth/two-factor/disable") {
          const { code, ...rest } = body ?? {};
          if (
            !(await confirmTwoFactorCode(
              auth,
              fromNodeHeaders(req.headers),
              code,
            ))
          )
            return reply.code(401).send({
              error: {
                code: "INVALID_CODE",
                message:
                  "That code isn't right. Enter the 6-digit code from your authenticator app or a recovery code.",
              },
            });
          body = rest;
        }
      }
      // Firms, members and invitations go through /v1 only, where our rules apply
      if (url.pathname.startsWith("/api/auth/organization/"))
        return reply.code(404).send({
          error: { code: "NOT_FOUND", message: "There is no such route." },
        });
      const request = new Request(url, {
        method: req.method,
        headers: fromNodeHeaders(req.headers),
        body: req.method === "POST" && body ? JSON.stringify(body) : undefined,
      });
      const response = await auth.handler(request);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      // A reply can set several cookies; each needs its own header
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(await response.text());
    },
  });

  app.decorateRequest("user");
  app.decorateRequest("session");
  app.decorate("authenticate", async (req: FastifyRequest) => {
    const found = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!found) {
      const token = tokenFromCookie(req.headers.cookie);
      if (token && (await wasReplaced(db, token)))
        throw new AppError(
          "SESSION_REPLACED",
          "You were logged out because this account was opened on another device.",
          401,
        );
      throw new AppError("UNAUTHENTICATED", "Please log in to continue.", 401);
    }
    req.user = found.user;
    req.session = found.session;
    setOriginDevice(
      deviceLabel(
        found.session as {
          deviceName?: string | null;
          platform?: string | null;
        },
      ),
    );

    // Keep "active 2 hours ago" honest without writing on every request
    const last = new Date(
      (found.session as { lastActiveAt?: Date }).lastActiveAt ?? 0,
    ).getTime();
    if (Date.now() - last > FIVE_MINUTES)
      await db
        .update(schema.session)
        .set({ lastActiveAt: new Date() })
        .where(eq(schema.session.id, found.session.id));
  });
}
