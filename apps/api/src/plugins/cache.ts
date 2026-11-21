import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest as Request,
} from "fastify";
import { firmVersionKey as key, type LiveEvent } from "@repo/backend/lib/live";
import type { RedisClient } from "@repo/backend/lib/redis";
import { createHash } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    firmDataVersion?: string;
  }
  interface FastifyContextConfig {
    /** A POST that only reads (batched reads, search, exports): no new data version. */
    readOnly?: boolean;
  }
  interface FastifyInstance {
    firmVersion: (firmId: string) => Promise<string>;
    /** After a committed write: new version, and a live notice to the firm. */
    bumpFirmVersion: (firmId: string) => Promise<void>;
    checkFreshFirmRead: (req: Request, reply: FastifyReply) => Promise<void>;
  }
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
  publish?: (event: LiveEvent) => Promise<void>,
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

  const nextVersion = async (firmId: string) => {
    if (redis) {
      try {
        return String(await redis.incr(key(firmId)));
      } catch {
        /* Fall back to this process, as reads do. */
      }
    }
    bumpLocalVersion(firmId);
    return localVersion(firmId);
  };

  app.decorate("bumpFirmVersion", async (firmId: string) => {
    const version = await nextVersion(firmId);
    // Open screens refetch on this notice; a lost one is repaired on reconnect.
    await publish?.({ t: "changed", f: firmId, v: version }).catch(
      (error: unknown) =>
        app.log.warn({ err: error }, "Live change notice was not sent"),
    );
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
    ) {
      // Account, write and error responses must not be stored by HTTP caches.
      if (!reply.hasHeader("cache-control"))
        reply.header("cache-control", "private, no-store");
      return payload;
    }
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
      reply.statusCode >= 400 ||
      req.routeOptions.config.readOnly
    )
      return;
    await app.bumpFirmVersion(req.firm.id);
  });
}
