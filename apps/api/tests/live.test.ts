import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import pg from "pg";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import {
  LIVE_CHANNEL,
  parseLiveEvent,
  readLiveTicket,
  type LiveEvent,
} from "@repo/backend/lib/live";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

const SECRET = "live-fixture-only-secret-not-used-anywhere";

// Only the explicitly supplied disposable database; never .env.
test(
  "the API hands out live passes and announces committed writes",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const databaseUrl = process.env.HISAAB_DATA_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_data");
    const { db, pool } = createDb(url.toString(), { workload: "maintenance" });
    const listener = new pg.Client({ connectionString: url.toString() });
    await listener.connect();
    await listener.query(`LISTEN ${LIVE_CHANNEL}`);
    const events: LiveEvent[] = [];
    listener.on("notification", (message) => {
      const event = parseLiveEvent(message.payload);
      if (event) events.push(event);
    });
    const mail = memorySender();
    const app = await buildApp({
      db,
      email: mail.sender,
      storage: fakeStorage(),
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET: "live-fixture-only-secret-not-used-by-accounts",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
        LIVE_TICKET_SECRET: SECRET,
        LIVE_PUBLIC_URL: "ws://localhost:3020/live",
      },
    });
    const tag = randomUUID().slice(0, 8);
    const headers = {
      origin: "http://localhost:8081",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    try {
      async function account(suffix: string) {
        const email = `live-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Live ${suffix}`,
            email,
            password: "Fixture-password-123!",
            phoneNumber: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
          },
        });
        assert.equal(signup.statusCode, 200, signup.body);
        const verify = await app.inject({
          method: "POST",
          url: "/api/auth/email-otp/verify-email",
          headers,
          payload: { email, otp: mail.lastCode(email) },
        });
        assert.equal(verify.statusCode, 200, verify.body);
        const cookies = verify.headers["set-cookie"];
        return {
          id: verify.json<{ user: { id: string } }>().user.id,
          cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
            .map((c) => c.split(";")[0])
            .join("; "),
        };
      }
      const owner = await account("owner");
      const sales = await account("sales");
      let firmId = "";
      const call = (
        who: { cookie: string },
        method: "GET" | "POST",
        path: string,
        payload?: object,
      ) =>
        app.inject({
          method,
          url: path,
          headers: {
            ...headers,
            cookie: who.cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...(method === "POST"
              ? { "idempotency-key": newRequestId(randomUUID()) }
              : {}),
          },
          payload,
        });
      const created = await call(owner, "POST", "/v1/firms", {
        name: `Live ${tag}`,
        city: "Delhi",
        stateCode: "07",
        gstRegistration: "unregistered",
      });
      assert.ok(created.statusCode < 300, created.body);
      firmId = created.json<{ id: string }>().id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: sales.id, role: "sales" });

      // A pass names this user, this session and this firm, and expires in a minute.
      const ticket = await call(sales, "POST", "/v1/live/ticket", {});
      assert.equal(ticket.statusCode, 200, ticket.body);
      const body = ticket.json<{
        enabled: true;
        ticket: string;
        url: string;
      }>();
      assert.equal(body.url, "ws://localhost:3020/live");
      const claims = readLiveTicket(SECRET, body.ticket);
      assert.ok(claims);
      assert.equal(claims.u, sales.id);
      assert.equal(claims.f, firmId);
      assert.match(ticket.headers["cache-control"] as string, /no-store/);

      // Reads, including batched POST reads and passes, announce nothing.
      await settle();
      events.length = 0;
      const batch = await call(owner, "POST", "/v1/reads/batch", {
        paths: ["/v1/parties"],
      });
      assert.equal(batch.statusCode, 200, batch.body);
      await call(owner, "GET", "/v1/parties");
      await settle();
      assert.deepEqual(
        events.filter((e) => e.t === "changed"),
        [],
      );

      // A committed write announces the firm's new version.
      const party = await call(owner, "POST", "/v1/parties", {
        name: `Customer ${tag}`,
        type: "customer",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      });
      assert.ok(party.statusCode < 300, party.body);
      await settle();
      const changed = events.filter((e) => e.t === "changed");
      assert.equal(changed.length, 1);
      assert.equal(changed[0].f, firmId);

      // A role change announces itself from the database, whoever made it.
      events.length = 0;
      await db
        .update(schema.member)
        .set({ role: "viewer" })
        .where(eq(schema.member.userId, sales.id));
      await settle();
      assert.ok(
        events.some(
          (e) => e.t === "access" && e.f === firmId && e.u === sales.id,
        ),
      );

      // Only roles that manage the team see who is online.
      const forViewer = await call(sales, "GET", "/v1/firms/current/presence");
      assert.equal(forViewer.statusCode, 403, forViewer.body);
      const presence = await call(owner, "GET", "/v1/firms/current/presence");
      assert.equal(presence.statusCode, 200, presence.body);
      const members = presence.json<{
        members: { userId: string; online: boolean; lastActiveAt: string }[];
      }>().members;
      assert.equal(members.length, 2);
      assert.ok(members.every((m) => m.online === false && m.lastActiveAt));
    } finally {
      await app.close();
      await listener.end();
      await pool.end();
    }
  },
);
