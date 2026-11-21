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
  "the owner restores a cancelled sale; others can't, and a restore that would oversell is refused",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 120_000 },
  async () => {
    const databaseUrl = process.env.HISAAB_DATA_TEST_URL;
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.match(url.pathname, /^\/hardening_data(_[a-z0-9]+)?$/);
    const { db, pool } = createDb(url.toString(), { workload: "maintenance" });
    const mail = memorySender();
    const app = await buildApp({
      db,
      email: mail.sender,
      storage: fakeStorage(),
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET: "restore-fixture-only-secret-not-used-by-users",
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
        const email = `restore-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Restore ${suffix}`,
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
      let firmId = "";
      const call = (
        who: { cookie: string },
        method: "GET" | "POST",
        path: string,
        payload?: object,
        extra: Record<string, string> = {},
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
            ...extra,
          },
          payload,
        });
      const ok = async <T>(
        who: { cookie: string },
        method: "GET" | "POST",
        path: string,
        payload?: object,
        extra?: Record<string, string>,
      ) => {
        const reply = await call(who, method, path, payload, extra);
        assert.ok(
          reply.statusCode < 300,
          `${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.json<T>();
      };

      firmId = (
        await ok<{ id: string }>(owner, "POST", "/v1/firms", {
          name: `Restore ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({
          organizationId: firmId,
          userId: accountant.id,
          role: "accountant",
        });
      const party = (type: "customer" | "supplier") =>
        ok<{ id: string }>(owner, "POST", "/v1/parties", {
          name: `${type} ${tag}`,
          type,
          phone: "",
          city: "Delhi",
          stateCode: "07",
          gstin: "",
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        });
      const supplier = await party("supplier");
      const customer = await party("customer");
      const item = await ok<{ id: string }>(owner, "POST", "/v1/items", {
        name: `Item ${tag}`,
        code: "",
        hsn: "",
        group: "",
        taxType: "nongst",
        gstRate: 0,
        unit: "Pcs",
        purchasePrice: 10000,
        salePrice: 15000,
        mrp: 0,
        reorderLevel: 0,
        openingStock: 0,
      });
      const today = new Date().toISOString().slice(0, 10);
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 2, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const sell = async (qty: number) =>
        (
          await ok<{ id: string; version: number }[]>(
            owner,
            "POST",
            "/v1/sales/split",
            {
              partyId: customer.id,
              date: today,
              lines: [{ itemId: item.id, qty, rate: 15000, gstRate: 0 }],
              charges: [],
            },
          )
        )[0];
      const cancel = (v: { id: string; version: number }) =>
        ok<{ id: string; version: number; status: string }>(
          owner,
          "POST",
          `/v1/vouchers/${v.id}/cancel`,
          { reason: "Entered twice" },
          { "if-match": String(v.version) },
        );
      type Page = {
        items: {
          id: string;
          version: number;
          reason?: string;
          restoreBlocker?: string;
        }[];
      };

      // Cancel a sale; it shows in the owner's list with its reason.
      const sale = await sell(1);
      const cancelled = await cancel(sale);
      const list = await ok<Page>(owner, "GET", "/v1/vouchers/cancelled");
      const row = list.items.find((x) => x.id === sale.id);
      assert.ok(row);
      assert.equal(row.reason, "Entered twice");
      assert.equal(row.restoreBlocker, undefined);

      // Not for other roles.
      assert.equal(
        (await call(accountant, "GET", "/v1/vouchers/cancelled")).statusCode,
        403,
      );
      const notOwner = await call(
        accountant,
        "POST",
        `/v1/vouchers/${sale.id}/restore`,
        undefined,
        {
          "if-match": String(cancelled.version),
        },
      );
      assert.equal(notOwner.statusCode, 403, notOwner.body);

      // The owner restores it: posted again, logged as "restored".
      const restored = await ok<{ status: string; number: string }>(
        owner,
        "POST",
        `/v1/vouchers/${sale.id}/restore`,
        undefined,
        { "if-match": String(row.version) },
      );
      assert.equal(restored.status, "posted");
      const log = await db
        .select({ action: schema.auditLog.action })
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.firmId, firmId),
            eq(schema.auditLog.voucherId, sale.id),
          ),
        );
      assert.deepEqual(
        log.map((l) => l.action),
        ["created", "cancelled", "restored"],
      );

      // Cancel a sale of both pieces, sell them again, and restoring would oversell.
      const big = await sell(1);
      const cancelledBig = await cancel(big);
      await sell(1);
      const blocked = (
        await ok<Page>(owner, "GET", "/v1/vouchers/cancelled")
      ).items.find((x) => x.id === big.id);
      assert.match(blocked?.restoreBlocker ?? "", /stock has been used/);
      const refused = await call(
        owner,
        "POST",
        `/v1/vouchers/${big.id}/restore`,
        undefined,
        {
          "if-match": String(cancelledBig.version),
        },
      );
      assert.equal(refused.statusCode, 409, refused.body);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
