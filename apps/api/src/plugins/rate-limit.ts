import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RedisClient } from "@repo/backend/lib/redis";
import { AppError } from "@repo/backend/lib/app-error";

declare module "fastify" {
  interface FastifyInstance {
    checkAuthRateLimit: (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<boolean>;
    checkEmailCodeLimit: (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<boolean>;
    checkCodeVerifyLimit: (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<boolean>;
    checkPasswordLoginLimit: (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<boolean>;
  }
}

type RateLimitCheck = ReturnType<FastifyInstance["createRateLimit"]>;
type LimitResult = Awaited<ReturnType<RateLimitCheck>>;

function bodyValue(req: FastifyRequest, key: string) {
  const body = req.body as Record<string, unknown> | undefined;
  const value = body?.[key];
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function ipKey(req: FastifyRequest) {
  return `ip:${req.ip}`;
}

function apiKey(req: FastifyRequest) {
  // The route's authentication hook runs first; raw credentials never identify a counter.
  return req.user?.id ? `user:${req.user.id}` : ipKey(req);
}

function emailKey(req: FastifyRequest, scope: string) {
  return `${scope}:${bodyValue(req, "email") ?? ipKey(req)}`;
}

function accountAndIpKey(req: FastifyRequest) {
  // A new prefix keeps old fifteen-minute Redis counters out of this window.
  return `login-minute:${bodyValue(req, "email") ?? "unknown"}:${req.ip}`;
}

function rateLimitBody() {
  return {
    error: {
      code: "RATE_LIMITED",
      message: "Too many tries. Please wait a bit and try again.",
    },
  };
}

async function allowOrReply(
  reply: FastifyReply,
  checked: LimitResult,
): Promise<boolean> {
  if ("isExceeded" in checked && checked.isExceeded) {
    reply.header("retry-after", checked.ttlInSeconds);
    reply.code(429).send(rateLimitBody());
    return false;
  }
  return true;
}

/** Registers the shared limiter store and named checks for sensitive routes. */
export async function registerRateLimits(
  app: FastifyInstance,
  redis?: RedisClient,
) {
  await app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    max: 300,
    timeWindow: "1 minute",
    redis,
    nameSpace: "hisaab-rate-limit:",
    skipOnError: true,
    allowList: (req) => req.method === "OPTIONS",
    keyGenerator: apiKey,
    errorResponseBuilder: () =>
      new AppError("RATE_LIMITED", rateLimitBody().error.message, 429),
  });

  const authOverall = app.createRateLimit({
    skipOnError: false,
    max: 60,
    timeWindow: "1 minute",
    keyGenerator: ipKey,
  });
  const emailPerHour = app.createRateLimit({
    skipOnError: false,
    max: 5,
    timeWindow: "1 hour",
    keyGenerator: (req) => emailKey(req, "email-hour"),
  });
  const emailPerDay = app.createRateLimit({
    skipOnError: false,
    max: 10,
    timeWindow: "1 day",
    keyGenerator: (req) => emailKey(req, "email-day"),
  });
  const codeVerify = app.createRateLimit({
    skipOnError: false,
    max: 20,
    timeWindow: "1 hour",
    keyGenerator: (req) => emailKey(req, "verify-hour"),
  });
  const passwordLogin = app.createRateLimit({
    skipOnError: false,
    max: 10,
    timeWindow: "1 minute",
    keyGenerator: accountAndIpKey,
  });

  app.decorate("checkAuthRateLimit", async (req, reply) =>
    allowOrReply(reply, await authOverall(req)),
  );
  app.decorate(
    "checkEmailCodeLimit",
    async (req, reply) =>
      (await allowOrReply(reply, await emailPerHour(req))) &&
      (await allowOrReply(reply, await emailPerDay(req))),
  );
  app.decorate("checkCodeVerifyLimit", async (req, reply) =>
    allowOrReply(reply, await codeVerify(req)),
  );
  app.decorate("checkPasswordLoginLimit", async (req, reply) =>
    allowOrReply(reply, await passwordLogin(req)),
  );
}
