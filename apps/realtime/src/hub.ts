import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { and, eq, gt } from "drizzle-orm";
import { WebSocket, WebSocketServer } from "ws";
import {
  LIVE_CLOSE,
  LiveClientMessage,
  Role,
  type LiveServerMessage,
} from "@repo/contracts";
import { can } from "@repo/core";
import { schema, type Db } from "@repo/backend/db/client";
import {
  firmVersionKey,
  publishLive,
  readLiveTicket,
  type LiveEvent,
} from "@repo/backend/lib/live";
import {
  countUserConnections,
  dropPresence,
  touchPresence,
  type PresenceEntry,
} from "@repo/backend/lib/live-presence";
import type { RedisClient } from "@repo/backend/lib/redis";

export const LIVE_PATH = "/live";
const HELLO_MS = 5_000;
/** Writes in quick succession reach each screen as one notice. */
const COALESCE_MS = 50;
const TICKET_USED_MS = 120_000;

type Log = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
};

type Conn = {
  id: string;
  ws: WebSocket;
  userId: string;
  sessionId: string;
  firmId: string;
  role: Role;
  entry: PresenceEntry;
  alive: boolean;
};

class Refused extends Error {
  constructor(
    readonly code: number,
    reason: string,
  ) {
    super(reason);
  }
}

const toRole = (value: string | null) =>
  value === null ? null : (Role.safeParse(value).data ?? null);

/**
 * Holds this instance's open sockets and nothing else. Who is online lives in
 * Redis, events arrive from PostgreSQL, and access is checked against the
 * database, so any instance can serve any connection and can be restarted at
 * will: its clients simply reconnect, to it or to another one.
 */
export function createLiveHub(options: {
  db: Db;
  redis: RedisClient;
  secret: string;
  log: Log;
  trustedOrigins: string[];
  beatMs: number;
  recheckMs: number;
  maxPerUser: number;
}) {
  const { db, redis, log } = options;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const conns = new Set<Conn>();
  const byFirm = new Map<string, Set<Conn>>();
  let closing = false;

  const send = (conn: Conn, message: LiveServerMessage) => {
    if (conn.ws.readyState === WebSocket.OPEN)
      conn.ws.send(JSON.stringify(message));
  };
  const inFirm = (firmId: string) => byFirm.get(firmId) ?? new Set<Conn>();

  async function lookup(userId: string, sessionId: string, firmId: string) {
    const [row] = await db
      .select({ role: schema.member.role })
      .from(schema.session)
      .leftJoin(
        schema.member,
        and(
          eq(schema.member.userId, schema.session.userId),
          eq(schema.member.organizationId, firmId),
        ),
      )
      .where(
        and(
          eq(schema.session.id, sessionId),
          eq(schema.session.userId, userId),
          gt(schema.session.expiresAt, new Date()),
        ),
      );
    return row ? { session: true, role: toRole(row.role) } : null;
  }

  const announcePresence = (firmId: string) =>
    publishLive(db, { t: "presence", f: firmId }).catch((error: unknown) =>
      log.warn({ err: error }, "Presence notice was not sent"),
    );

  function register(conn: Conn) {
    conns.add(conn);
    const set = byFirm.get(conn.firmId) ?? new Set<Conn>();
    set.add(conn);
    byFirm.set(conn.firmId, set);
  }

  async function leave(conn: Conn) {
    if (!conns.delete(conn)) return;
    const set = byFirm.get(conn.firmId);
    set?.delete(conn);
    if (set && !set.size) byFirm.delete(conn.firmId);
    try {
      await dropPresence(redis, conn.id, conn.entry);
    } catch (error) {
      log.warn({ err: error }, "Presence entry was left to expire");
    }
    await announcePresence(conn.firmId);
  }

  async function hello(ws: WebSocket, text: string) {
    let parsed: ReturnType<typeof LiveClientMessage.safeParse>;
    try {
      parsed = LiveClientMessage.safeParse(JSON.parse(text));
    } catch {
      throw new Refused(LIVE_CLOSE.invalid, "Send hello first");
    }
    if (!parsed.success)
      throw new Refused(LIVE_CLOSE.invalid, "Send hello first");
    const message = parsed.data;
    const claims = readLiveTicket(options.secret, message.ticket);
    if (!claims)
      throw new Refused(LIVE_CLOSE.unauthorized, "Pass expired or invalid");
    // Single use, across every instance.
    const fresh = await redis.set(
      `live:ticket:${claims.j}`,
      "1",
      "PX",
      TICKET_USED_MS,
      "NX",
    );
    if (fresh !== "OK")
      throw new Refused(LIVE_CLOSE.unauthorized, "Pass already used");
    const access = await lookup(claims.u, claims.s, claims.f);
    if (!access) throw new Refused(LIVE_CLOSE.unauthorized, "Session ended");
    if (!access.role)
      throw new Refused(LIVE_CLOSE.accessChanged, "Not a member of this firm");
    if ((await countUserConnections(redis, claims.u)) >= options.maxPerUser)
      throw new Refused(LIVE_CLOSE.tooMany, "Too many open connections");
    const version = (await redis.get(firmVersionKey(claims.f))) ?? "0";
    if (ws.readyState !== WebSocket.OPEN || closing) return null;
    const conn: Conn = {
      id: randomUUID(),
      ws,
      userId: claims.u,
      sessionId: claims.s,
      firmId: claims.f,
      role: access.role,
      alive: true,
      entry: {
        firmId: claims.f,
        userId: claims.u,
        platform: message.platform,
        device:
          message.device ||
          (message.platform === "web" ? "Web browser" : "Phone"),
        since: new Date().toISOString(),
      },
    };
    register(conn);
    return { conn, version };
  }

  function accept(ws: WebSocket) {
    let conn: Conn | undefined;
    let started = false;
    const timer = setTimeout(
      () => ws.close(LIVE_CLOSE.unauthorized, "Send hello first"),
      HELLO_MS,
    );
    ws.on("message", (data, isBinary) => {
      // Only one message is ever expected: the hello.
      if (started || isBinary) {
        ws.close(LIVE_CLOSE.invalid, "Unexpected message");
        return;
      }
      started = true;
      void hello(ws, String(data))
        .then(async (result) => {
          clearTimeout(timer);
          if (!result) return;
          conn = result.conn;
          send(conn, {
            type: "ready",
            firmId: conn.firmId,
            version: result.version,
            beatMs: options.beatMs,
          });
          await touchPresence(redis, conn.id, conn.entry);
          await announcePresence(conn.firmId);
        })
        .catch((error: unknown) => {
          clearTimeout(timer);
          if (error instanceof Refused) ws.close(error.code, error.message);
          else {
            log.warn({ err: error }, "Live connection could not start");
            ws.close(1011, "Try again shortly");
          }
        });
    });
    ws.on("pong", () => {
      if (conn) conn.alive = true;
    });
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(timer);
      if (conn) void leave(conn);
    });
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const path = new URL(req.url ?? "/", "http://live").pathname;
    if (path !== LIVE_PATH) return refuse("404 Not Found");
    // Apps send no Origin; a web page must be one of ours.
    const origin = req.headers.origin;
    if (origin && !options.trustedOrigins.includes(origin))
      return refuse("403 Forbidden");
    if (closing) return refuse("503 Service Unavailable");
    wss.handleUpgrade(req, socket, head, accept);
  }

  // ---- Events from the API and the database --------------------------------

  const pendingChanges = new Map<string, string>();
  const pendingPresence = new Set<string>();
  let flushTimer: NodeJS.Timeout | undefined;
  const scheduleFlush = () => {
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined;
      for (const [firmId, version] of pendingChanges)
        for (const conn of inFirm(firmId))
          send(conn, { type: "changed", version });
      for (const firmId of pendingPresence)
        for (const conn of inFirm(firmId))
          if (can(conn.role, "team")) send(conn, { type: "presence" });
      pendingChanges.clear();
      pendingPresence.clear();
    }, COALESCE_MS);
  };

  async function recheck(conn: Conn) {
    try {
      const access = await lookup(conn.userId, conn.sessionId, conn.firmId);
      if (!access) conn.ws.close(LIVE_CLOSE.unauthorized, "Session ended");
      else if (access.role !== conn.role)
        conn.ws.close(LIVE_CLOSE.accessChanged, "Access changed");
    } catch (error) {
      log.warn({ err: error }, "Live access check failed; will retry");
    }
  }

  function onEvent(event: LiveEvent) {
    switch (event.t) {
      case "changed":
        pendingChanges.set(event.f, event.v);
        scheduleFlush();
        break;
      case "presence":
        pendingPresence.add(event.f);
        scheduleFlush();
        break;
      case "session":
        for (const conn of conns)
          if (conn.sessionId === event.s)
            conn.ws.close(LIVE_CLOSE.unauthorized, "Session ended");
        break;
      case "access":
        for (const conn of conns) {
          if (conn.userId !== event.u) continue;
          send(conn, { type: "access" });
          if (conn.firmId === event.f) void recheck(conn);
        }
        break;
    }
  }

  /** Notices may have been missed (the event connection dropped): refetch all. */
  function resyncAll() {
    for (const conn of conns) send(conn, { type: "resync" });
  }

  const beat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
      send(conn, { type: "beat" });
      touchPresence(redis, conn.id, conn.entry).catch(() => undefined);
    }
  }, options.beatMs);
  const sweep = setInterval(() => {
    void (async () => {
      for (const conn of [...conns]) await recheck(conn);
    })();
  }, options.recheckMs);

  return {
    handleUpgrade,
    onEvent,
    resyncAll,
    size: () => conns.size,
    /** Ask every client to reconnect (to any instance), then clean up. */
    async close() {
      closing = true;
      clearInterval(beat);
      clearInterval(sweep);
      clearTimeout(flushTimer);
      for (const ws of wss.clients) ws.close(LIVE_CLOSE.restart, "Restarting");
      await Promise.all([...conns].map(leave));
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
