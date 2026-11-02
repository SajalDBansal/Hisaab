import { after as afterAll, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, createConnection, type Socket } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { sql } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { createRedis, createJobRedis } from "../src/lib/redis";
import { registerRateLimits } from "../../../apps/api/src/plugins/rate-limit";

function fixture<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing isolated test fixture");
  return value;
}

const databaseUrl = process.env.INFRA_TEST_DATABASE_URL;
const redisUrl = process.env.INFRA_TEST_REDIS_URL;
if (databaseUrl && new URL(databaseUrl).pathname !== "/hardening_infra")
  throw new Error("Use only the assigned disposable hardening_infra database.");
const databaseTest = databaseUrl ? test : test.skip;
const redisTest = redisUrl ? test : test.skip;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A command timeout can precede the socket-close event by one event-loop turn.
async function readyRedis(client: ReturnType<typeof createRedis>) {
  if (client.status === "wait") void client.connect().catch(() => undefined);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (client.status === "ready") {
      try {
        await client.ping();
        return;
      } catch {
        /* Wait for reconnection. */
      }
    }
    await pause(50);
  }
  throw new Error("The isolated Redis client did not reconnect");
}

// Drop replies after connection establishment to reproduce a blackholed socket.
async function proxyTo(url: string) {
  const target = new URL(url);
  const upstreamAddress = { host: target.hostname, port: Number(target.port) };
  const sockets = new Set<Socket>();
  let dropReplies = false;
  const server = createServer((client) => {
    const upstream = createConnection(upstreamAddress);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on("error", () => undefined);
      socket.on("close", () => sockets.delete(socket));
    }
    client.on("data", (bytes) => upstream.write(bytes));
    upstream.on("data", (bytes) => {
      if (!dropReplies) client.write(bytes);
    });
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No proxy port");
  target.hostname = "127.0.0.1";
  target.port = String(address.port);
  return {
    url: target.toString(),
    dropReplies: (value: boolean) => (dropReplies = value),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const testDb = databaseUrl
  ? createDb(databaseUrl, {
      max: 2,
      connectionTimeoutMillis: 200,
      statementTimeoutMillis: 120,
      queryTimeoutMillis: 400,
      lockTimeoutMillis: 80,
    })
  : undefined;
afterAll(async () => {
  if (!testDb) return;
  await testDb.pool.query("drop table if exists infra_timeout_probe");
  await testDb.pool.end();
});

databaseTest(
  "server timeout rolls back writes and leaves the pool usable",
  async () => {
    const { pool, db } = fixture(testDb);
    await pool.query(
      "create table if not exists infra_timeout_probe(id integer primary key)",
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute(sql`insert into infra_timeout_probe values (1)`);
        await tx.execute(sql`select pg_sleep(0.5)`);
      }),
    );
    await assert.rejects(
      pool.query("insert into infra_timeout_probe select 2 from pg_sleep(0.5)"),
      { code: "57014" },
    );
    await pause(550);
    assert.equal(
      (await pool.query("select * from infra_timeout_probe")).rowCount,
      0,
    );
    assert.equal((await pool.query("select 1 as value")).rows[0].value, 1);
  },
);

databaseTest(
  "a blocked lock fails on PostgreSQL within its deadline",
  async () => {
    const { pool } = fixture(testDb);
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(94012)");
      const started = performance.now();
      await assert.rejects(pool.query("select pg_advisory_xact_lock(94012)"), {
        code: "55P03",
      });
      assert.ok(performance.now() - started < 1_000);
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  },
);

databaseTest(
  "waiting for a busy pool has a bounded acquisition deadline",
  async () => {
    const { pool } = createDb(fixture(databaseUrl), {
      max: 1,
      connectionTimeoutMillis: 100,
    });
    const holder = await pool.connect();
    try {
      await assert.rejects(pool.query("select 1"), /timeout/i);
    } finally {
      holder.release();
      assert.equal((await pool.query("select 1")).rowCount, 1);
      await pool.end();
    }
  },
);

databaseTest(
  "blackholed transaction and pool queries destroy sockets and recover",
  async () => {
    const proxy = await proxyTo(fixture(databaseUrl));
    const { pool, db } = createDb(proxy.url, {
      max: 1,
      connectionTimeoutMillis: 400,
      statementTimeoutMillis: 120,
      queryTimeoutMillis: 200,
    });
    try {
      await pool.query("select 1");
      proxy.dropReplies(true);
      await assert.rejects(pool.query("select 1"), /Query read timeout/);
      proxy.dropReplies(false);
      assert.equal((await pool.query("select 1")).rowCount, 1);
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.execute(sql`select 1`);
          proxy.dropReplies(true);
          await tx.execute(sql`select 1`);
        }),
      );
      proxy.dropReplies(false);
      await pause(20);
      assert.equal(pool.waitingCount, 0);
      assert.equal(pool.totalCount, 0);
      assert.equal((await pool.query("select 1")).rowCount, 1);
    } finally {
      await pool.end();
      await proxy.close();
    }
  },
);

databaseTest(
  "a lost commit reply does not silently replay or erase an accepted write",
  async () => {
    const proxy = await proxyTo(fixture(databaseUrl));
    const { pool } = createDb(proxy.url, { max: 1, queryTimeoutMillis: 200 });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("insert into infra_timeout_probe values (3)");
      proxy.dropReplies(true);
      await assert.rejects(client.query("commit"), /Query read timeout/);
    } finally {
      client.release();
      proxy.dropReplies(false);
      await pool.end();
      await proxy.close();
    }
    // The response was lost, not the commit: recovery must look up the original write.
    const { pool: observer } = fixture(testDb);
    assert.equal(
      (await observer.query("select id from infra_timeout_probe where id=3"))
        .rowCount,
      1,
    );
    await observer.query("delete from infra_timeout_probe where id=3");
  },
);

databaseTest(
  "multi-statement work is allowed but its transaction remains bounded",
  async () => {
    const { db, pool } = createDb(fixture(databaseUrl), {
      statementTimeoutMillis: 120,
      queryTimeoutMillis: 400,
      transactionTimeoutMillis: 350,
    });
    pool.on("error", () => undefined);
    try {
      await db.transaction(async (tx) => {
        for (let i = 0; i < 3; i++)
          await tx.execute(sql`select pg_sleep(0.06)`);
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          for (let i = 0; i < 20; i++)
            await tx.execute(sql`select pg_sleep(0.06)`);
        }),
      );
      assert.equal((await pool.query("select 1")).rowCount, 1);
    } finally {
      await pool.end();
    }
  },
);

redisTest(
  "a lost Redis reply is bounded and never replays its mutation",
  async () => {
    const proxy = await proxyTo(fixture(redisUrl));
    const redis = createRedis(proxy.url, 300);
    const observer = createRedis(fixture(redisUrl));
    for (const client of [redis, observer]) client.on("error", () => undefined);
    const key = `hardening-infra:${randomUUID()}`;
    try {
      await Promise.all([readyRedis(redis), readyRedis(observer)]);
      proxy.dropReplies(true);
      const started = performance.now();
      await assert.rejects(redis.incr(key));
      assert.ok(performance.now() - started < 2_000);
      proxy.dropReplies(false);
      await readyRedis(redis);
      await pause(100);
      assert.equal(await observer.get(key), "1");
      assert.equal(await redis.ping(), "PONG");
    } finally {
      await observer.del(key);
      redis.disconnect();
      observer.disconnect();
      await proxy.close();
    }
  },
);

redisTest(
  "authentication fails closed when its Redis store stalls",
  async () => {
    const proxy = await proxyTo(fixture(redisUrl));
    const redis = createRedis(proxy.url, 300);
    redis.on("error", () => undefined);
    const app = Fastify();
    let accepted = 0;
    try {
      await readyRedis(redis);
      await registerRateLimits(app, redis);
      for (const [path, check] of [
        ["login", app.checkPasswordLoginLimit],
        ["verify", app.checkCodeVerifyLimit],
      ] as const)
        app.post(`/${path}`, async (req, reply) => {
          if (!(await check(req, reply))) return;
          accepted++;
          return { ok: true };
        });
      await app.ready();
      proxy.dropReplies(true);
      for (const path of ["login", "verify"]) {
        const response = await app.inject({
          method: "POST",
          url: `/${path}`,
          payload: { email: `${randomUUID()}@example.invalid` },
        });
        assert.ok(response.statusCode >= 500);
      }
      assert.equal(accepted, 0);
    } finally {
      await app.close();
      redis.disconnect();
      await proxy.close();
    }
  },
);

test("BullMQ blocking clients keep independent timeout settings", () => {
  const redis = createJobRedis("redis://127.0.0.1:1");
  redis.on("error", () => undefined);
  assert.equal(redis.options.commandTimeout, undefined);
  assert.equal(redis.options.socketTimeout, undefined);
  assert.equal(redis.options.maxRetriesPerRequest, null);
  redis.disconnect();
});
