import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "the owner hands the firm to another member, and only the owner can",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const databaseUrl = process.env.HISAAB_DATA_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/hardening_data");
    const { db, pool } = createDb(url.toString(), { workload: "maintenance" });
    const mail = memorySender();
    const app = await buildApp({
      db,
      email: mail.sender,
      storage: fakeStorage(),
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET: "transfer-fixture-only-secret-not-used-by-users",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
      },
    });
    const tag = randomUUID().slice(0, 8);
    const headers = {
      origin: "http://localhost:8081",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    };
    try {
      async function account(suffix: string) {
        const email = `transfer-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Transfer ${suffix}`,
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
      const accountant = await account("accountant");
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

      const firmName = `Transfer ${tag}`;
      const created = await call(owner, "POST", "/v1/firms", {
        name: firmName,
        city: "Delhi",
        stateCode: "07",
        gstRegistration: "unregistered",
      });
      assert.ok(created.statusCode < 300, created.body);
      firmId = created.json<{ id: string }>().id;
      await db.insert(schema.member).values([
        { organizationId: firmId, userId: accountant.id, role: "accountant" },
        { organizationId: firmId, userId: sales.id, role: "sales" },
      ]);
      const memberOf = async (userId: string) => {
        const [row] = await db
          .select({ id: schema.member.id, role: schema.member.role })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, firmId),
              eq(schema.member.userId, userId),
            ),
          );
        assert.ok(row);
        return row;
      };
      const accountantMember = await memberOf(accountant.id);
      const salesMember = await memberOf(sales.id);
      const transfer = (who: { cookie: string }, body: object) =>
        call(who, "POST", "/v1/firms/current/transfer-ownership", body);

      // Someone who isn't the owner can't take or give the firm.
      const notOwner = await transfer(sales, {
        memberId: salesMember.id,
        confirmName: firmName,
      });
      assert.equal(notOwner.statusCode, 403, notOwner.body);

      // The firm name has to be typed to confirm.
      const wrongName = await transfer(owner, {
        memberId: accountantMember.id,
        confirmName: "Some other firm",
      });
      assert.equal(wrongName.statusCode, 400, wrongName.body);
      assert.equal((await memberOf(owner.id)).role, "owner");

      // The owner can't hand the firm to themselves.
      const self = await transfer(owner, {
        memberId: (await memberOf(owner.id)).id,
        confirmName: firmName,
      });
      assert.equal(self.statusCode, 400, self.body);

      const done = await transfer(owner, {
        memberId: accountantMember.id,
        previousOwnerRole: "viewer",
        confirmName: `  ${firmName.toUpperCase()} `,
      });
      assert.equal(done.statusCode, 200, done.body);

      // Exactly one owner afterwards; the old owner has the role they chose.
      const roles = await db
        .select({ userId: schema.member.userId, role: schema.member.role })
        .from(schema.member)
        .where(eq(schema.member.organizationId, firmId));
      assert.deepEqual(
        roles.filter((r) => r.role === "owner").map((r) => r.userId),
        [accountant.id],
      );
      assert.equal((await memberOf(owner.id)).role, "viewer");

      // The old owner lost owner rights at once; the new owner has them.
      const again = await transfer(owner, {
        memberId: salesMember.id,
        confirmName: firmName,
      });
      assert.equal(again.statusCode, 403, again.body);
      const firms = await call(accountant, "GET", "/v1/firms");
      assert.equal(firms.statusCode, 200, firms.body);
      assert.ok(firms.body.includes('"role":"owner"'), firms.body);

      // The hand-over is kept in the firm's control history.
      const events = await db
        .select()
        .from(schema.bookControlEvents)
        .where(
          and(
            eq(schema.bookControlEvents.firmId, firmId),
            eq(schema.bookControlEvents.action, "transfer-ownership"),
          ),
        );
      assert.equal(events.length, 1);
      assert.equal(events[0].userId, owner.id);
      assert.deepEqual(events[0].after, {
        owner: accountant.id,
        previousOwnerRole: "viewer",
      });
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
