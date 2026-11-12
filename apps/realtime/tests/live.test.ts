import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";
import { LIVE_CLOSE, type LiveServerMessage } from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import {
  issueLiveTicket,
  publishLive,
  readLiveTicket,
} from "@repo/backend/lib/live";
import { firmPresence } from "@repo/backend/lib/live-presence";
import { createRedis } from "@repo/backend/lib/redis";
import { listenLive } from "../src/bus";
import { createLiveHub, LIVE_PATH } from "../src/hub";

const SECRET = "live-fixture-only-secret-not-used-anywhere";

describe("one-time passes", () => {
  const claims = { userId: "u", sessionId: "s", firmId: "f" };
  test("a genuine pass reads back; tampered, foreign or expired ones don't", () => {
    const { ticket } = issueLiveTicket(SECRET, claims);
    expect(readLiveTicket(SECRET, ticket)).toMatchObject({
      u: "u",
      s: "s",
      f: "f",
    });
    const [body, mac] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        f: "other",
      }),
    ).toString("base64url");
    expect(readLiveTicket(SECRET, `${forged}.${mac}`)).toBeNull();
    expect(readLiveTicket(`${SECRET}-other`, ticket)).toBeNull();
    expect(readLiveTicket(SECRET, `${ticket}.x`)).toBeNull();
    expect(readLiveTicket(SECRET, ticket, Date.now() + 61_000)).toBeNull();
  });
});

const databaseUrl = process.env.LIVE_TEST_DATABASE_URL;
const redisUrl = process.env.LIVE_TEST_REDIS_URL;

// Only the explicitly supplied disposable database; never .env.
describe.skipIf(!databaseUrl || !redisUrl)("live service", () => {
  const { db, pool } = createDb(databaseUrl ?? "postgres://unused", {
    workload: "maintenance",
  });
  const redis = createRedis(redisUrl ?? "redis://unused");
  const quiet = { info: () => undefined, warn: () => undefined };
  let hub: ReturnType<typeof createLiveHub>;
  let bus: ReturnType<typeof listenLive>;
  let server: Server;
  let url = "";
  const tag = randomUUID().slice(0, 8);
  const ids = {
    firmA: randomUUID(),
    firmB: randomUUID(),
    owner: randomUUID(),
    sales: randomUUID(),
    otherOwner: randomUUID(),
    outsider: randomUUID(),
  };
  const sessions: Record<string, string> = {};

  beforeAll(async () => {
    const parsed = new URL(databaseUrl ?? "");
    expect(["127.0.0.1", "localhost"]).toContain(parsed.hostname);
    expect(parsed.pathname.startsWith("/hardening_")).toBe(true);
    await redis.connect();
    for (const key of ["owner", "sales", "otherOwner", "outsider"] as const) {
      await db.insert(schema.user).values({
        id: ids[key],
        name: `${key} ${tag}`,
        email: `live-${tag}-${key}@example.invalid`,
      });
      const [session] = await db
        .insert(schema.session)
        .values({
          token: `live-${tag}-${key}`,
          userId: ids[key],
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: schema.session.id });
      sessions[key] = session.id;
    }
    await db.insert(schema.organization).values([
      { id: ids.firmA, name: `Live A ${tag}` },
      { id: ids.firmB, name: `Live B ${tag}` },
    ]);
    await db.insert(schema.member).values([
      { organizationId: ids.firmA, userId: ids.owner, role: "owner" },
      { organizationId: ids.firmA, userId: ids.sales, role: "sales" },
      { organizationId: ids.firmB, userId: ids.otherOwner, role: "owner" },
    ]);
    hub = createLiveHub({
      db,
      redis,
      secret: SECRET,
      log: quiet,
      trustedOrigins: ["http://localhost:8081"],
      beatMs: 60_000,
      recheckMs: 3_600_000,
      maxPerUser: 2,
    });
    bus = listenLive({
      databaseUrl: databaseUrl ?? "",
      log: quiet,
      onEvent: hub.onEvent,
      onRestored: hub.resyncAll,
    });
    server = createServer();
    server.on("upgrade", hub.handleUpgrade);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${LIVE_PATH}`;
    for (let i = 0; i < 50 && !bus.listening(); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bus.listening()).toBe(true);
  });

  afterAll(async () => {
    await hub?.close();
    await bus?.close();
    await new Promise((resolve) => server?.close(resolve));
    await redis.quit();
    await pool.end();
  });

  type Socket = {
    ws: WebSocket;
    seen: LiveServerMessage[];
    next: (
      type: LiveServerMessage["type"],
      ms?: number,
    ) => Promise<LiveServerMessage>;
    closed: Promise<number>;
  };
  function open(ticket: string, headers: Record<string, string> = {}): Socket {
    const ws = new WebSocket(url, { headers });
    const seen: LiveServerMessage[] = [];
    const waiters: (() => void)[] = [];
    ws.on("message", (data) => {
      seen.push(JSON.parse(String(data)) as LiveServerMessage);
      for (const wake of waiters.splice(0)) wake();
    });
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "hello", ticket, platform: "web" })),
    );
    const closed = new Promise<number>((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );
    ws.on("error", () => undefined);
    const next = async (type: LiveServerMessage["type"], ms = 3_000) => {
      const until = Date.now() + ms;
      for (;;) {
        const index = seen.findIndex((m) => m.type === type);
        if (index >= 0) return seen.splice(index, 1)[0];
        const left = until - Date.now();
        if (left <= 0) throw new Error(`No "${type}" message`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, left);
        });
      }
    };
    return { ws, seen, next, closed };
  }
  const pass = (user: keyof typeof ids, firm: "firmA" | "firmB") =>
    issueLiveTicket(SECRET, {
      userId: ids[user],
      sessionId: sessions[user],
      firmId: ids[firm],
    }).ticket;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

  test("refuses bad, reused and foreign passes, and other sites", async () => {
    expect(await open("not-a-pass").closed).toBe(LIVE_CLOSE.unauthorized);
    const once = pass("owner", "firmA");
    const first = open(once);
    await first.next("ready");
    expect(await open(once).closed).toBe(LIVE_CLOSE.unauthorized);
    first.ws.close();
    await first.closed;
    expect(await open(pass("outsider", "firmA")).closed).toBe(
      LIVE_CLOSE.accessChanged,
    );
    const site = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url, {
        headers: { origin: "https://evil.example" },
      });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => undefined);
    });
    expect(site).toBe(403);
  });

  test("changes reach only that firm, and only after commit", async () => {
    const owner = open(pass("owner", "firmA"));
    const sales = open(pass("sales", "firmA"));
    const other = open(pass("otherOwner", "firmB"));
    await Promise.all([
      owner.next("ready"),
      sales.next("ready"),
      other.next("ready"),
    ]);
    await settle();
    owner.seen.length = sales.seen.length = other.seen.length = 0;

    await db
      .transaction(async (tx) => {
        await publishLive(tx, { t: "changed", f: ids.firmA, v: "41" });
        throw new Error("roll back");
      })
      .catch(() => undefined);
    await settle();
    expect(owner.seen.some((m) => m.type === "changed")).toBe(false);

    await publishLive(db, { t: "changed", f: ids.firmA, v: "42" });
    await publishLive(db, { t: "changed", f: ids.firmA, v: "43" });
    expect(await owner.next("changed")).toEqual({
      type: "changed",
      version: "43",
    });
    expect(await sales.next("changed")).toEqual({
      type: "changed",
      version: "43",
    });
    await settle();
    // Two quick writes arrive as one notice; firm B hears nothing.
    expect(owner.seen.filter((m) => m.type === "changed")).toHaveLength(0);
    expect(other.seen.some((m) => m.type === "changed")).toBe(false);

    for (const s of [owner, sales, other]) s.ws.close();
    await Promise.all([owner.closed, sales.closed, other.closed]);
  });

  test("owners see who is online; sales staff get no presence notices", async () => {
    const owner = open(pass("owner", "firmA"));
    await owner.next("ready");
    const sales = open(pass("sales", "firmA"));
    await sales.next("ready");
    await owner.next("presence");
    const online = await firmPresence(redis, ids.firmA);
    expect(online.map((e) => e.userId).sort()).toEqual(
      [ids.owner, ids.sales].sort(),
    );
    await settle();
    expect(sales.seen.some((m) => m.type === "presence")).toBe(false);

    sales.ws.close();
    await sales.closed;
    await owner.next("presence");
    expect((await firmPresence(redis, ids.firmA)).map((e) => e.userId)).toEqual(
      [ids.owner],
    );
    owner.ws.close();
    await owner.closed;
  });

  test("a role change or removal closes that person's socket at once", async () => {
    const sales = open(pass("sales", "firmA"));
    await sales.next("ready");
    await db
      .update(schema.member)
      .set({ role: "viewer" })
      .where(eq(schema.member.userId, ids.sales));
    await sales.next("access");
    expect(await sales.closed).toBe(LIVE_CLOSE.accessChanged);

    // With the new role a new pass works again.
    const viewer = open(pass("sales", "firmA"));
    await viewer.next("ready");
    await db.delete(schema.member).where(eq(schema.member.userId, ids.sales));
    expect(await viewer.closed).toBe(LIVE_CLOSE.accessChanged);
  });

  test("logging out closes the sockets of that session", async () => {
    const owner = open(pass("owner", "firmA"));
    await owner.next("ready");
    await db
      .delete(schema.session)
      .where(eq(schema.session.id, sessions.owner));
    expect(await owner.closed).toBe(LIVE_CLOSE.unauthorized);
    expect(await open(pass("owner", "firmA")).closed).toBe(
      LIVE_CLOSE.unauthorized,
    );
  });

  test("limits connections per person, and restarts hand clients back", async () => {
    const a = open(pass("otherOwner", "firmB"));
    const b = open(pass("otherOwner", "firmB"));
    await Promise.all([a.next("ready"), b.next("ready")]);
    await settle();
    expect(await open(pass("otherOwner", "firmB")).closed).toBe(
      LIVE_CLOSE.tooMany,
    );

    hub.resyncAll();
    await a.next("resync");
    await hub.close();
    expect(await a.closed).toBe(LIVE_CLOSE.restart);
    expect(await b.closed).toBe(LIVE_CLOSE.restart);
    expect(await firmPresence(redis, ids.firmB)).toEqual([]);
  });
});
