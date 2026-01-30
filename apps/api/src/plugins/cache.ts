import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest as Request,
} from "fastify";
import type { RedisClient } from "@repo/backend/lib/redis";
import { createHash } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    firmDataVersion?: string;
  }
  interface FastifyInstance {
    firmVersion: (firmId: string) => Promise<string>;
    bumpFirmVersion: (firmId: string) => Promise<void>;
    checkFreshFirmRead: (req: Request, reply: FastifyReply) => Promise<void>;
  }
}

function key(firmId: string) {
  return `firm:${firmId}:ver`;
}

function etag(req: Request, version: string, payload: string | Buffer) {
  const scope = [req.firm.id, req.user?.id, req.firm.role, req.url, version];
  return `"${createHash("sha256").update(JSON.stringify(scope)).update(payload).digest("hex")}"`;
}

function matchesEtag(header: string | undefined, tag: string) {
  return header?.split(",").some((value) => {
    const candidate = value.trim();
    return candidate === "*" || candidate.replace(/^W\//, "") === tag;
  });
}

export function registerCacheHelpers(
  app: FastifyInstance,
  redis?: RedisClient,
) {
  const localVersions = new Map<string, number>();
  const localVersion = (firmId: string) =>
    String(localVersions.get(firmId) ?? 0);
  const bumpLocalVersion = (firmId: string) => {
    localVersions.set(firmId, (localVersions.get(firmId) ?? 0) + 1);
  };

  app.decorate("firmVersion", async (firmId: string) => {
    if (!redis) return localVersion(firmId);
    try {
      // A read must not overwrite a concurrent writer's first increment.
      return (await redis.get(key(firmId))) ?? "0";
    } catch {
      return localVersion(firmId);
    }
  });

  app.decorate("bumpFirmVersion", async (firmId: string) => {
    if (!redis) {
      bumpLocalVersion(firmId);
      return;
    }
    try {
      await redis.incr(key(firmId));
    } catch {
      bumpLocalVersion(firmId);
    }
  });

  app.decorate("checkFreshFirmRead", async (req, reply) => {
    if (!["GET", "HEAD"].includes(req.method) || !req.firm) return;
    const version = await app.firmVersion(req.firm.id);
    req.firmDataVersion = version;
    reply.header("cache-control", "private, no-cache");
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (
      !["GET", "HEAD"].includes(req.method) ||
      !req.firm ||
      reply.statusCode !== 200
    )
      return payload;
    if (String(reply.getHeader("cache-control") ?? "").includes("no-store"))
      return payload;
    const version = req.firmDataVersion ?? (await app.firmVersion(req.firm.id));
    if (typeof payload !== "string" && !Buffer.isBuffer(payload))
      return payload;
    // Validate the representation too: dates, permissions and expiring links can change without a write.
    const tag = etag(req, version, payload);
    reply.header("etag", tag).header("cache-control", "private, no-cache");
    reply.header(
      "vary",
      [reply.getHeader("vary"), "Cookie, Authorization, X-Firm-Id"]
        .filter(Boolean)
        .join(", "),
    );
    if (matchesEtag(req.headers["if-none-match"], tag)) {
      reply.code(304).removeHeader("content-length");
      return "";
    }
    return payload;
  });

  app.addHook("onResponse", async (req, reply) => {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS" ||
      !req.firm ||
      reply.statusCode >= 400
    )
      return;
    await app.bumpFirmVersion(req.firm.id);
  });
}
