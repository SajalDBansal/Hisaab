import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "products and rates per party, and who supplies or buys a product",
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
        BETTER_AUTH_SECRET: "rates-fixture-only-secret-not-used-by-accounts",
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
        const email = `rates-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Cost ${suffix}`,
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
        method: "GET" | "POST" | "PUT",
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
        method: "GET" | "POST" | "PUT",
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
          name: `Rates ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: sales.id, role: "sales" });
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
      const itemInput = {
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
      };
      const item = await ok<{ id: string; version: number }>(
        owner,
        "POST",
        "/v1/items",
        itemInput,
      );
      const today = new Date().toISOString().slice(0, 10);
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      // Sales staff sell 2 of the 10 bought.
      await ok(sales, "POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: item.id, qty: 2, rate: 15000, gstRate: 0 }],
        charges: [],
      });

      type Rate = {
        partyName: string;
        itemId: string;
        rate: number;
        typedRate: number;
        qty: number;
        stockQty: number | null;
      };

      // The owner sees the supplier's product, rate and stock left from them.
      const supplied = await ok<{ rows: Rate[] }>(
        owner,
        "GET",
        `/v1/parties/${supplier.id}/items`,
      );
      assert.equal(supplied.rows.length, 1);
      assert.deepEqual(
        [
          supplied.rows[0].rate,
          supplied.rows[0].qty,
          supplied.rows[0].stockQty,
        ],
        [10000, 10, 8],
      );
      const history = await ok<{ type: string; qty: number }[]>(
        owner,
        "GET",
        `/v1/parties/${supplier.id}/items/${item.id}`,
      );
      assert.deepEqual(
        history.map((h) => [h.type, h.qty]),
        [["purchase", 10]],
      );

      // Sales staff see what customers buy, never what suppliers charge.
      const bought = await ok<{ rows: Rate[] }>(
        sales,
        "GET",
        `/v1/parties/${customer.id}/items`,
      );
      assert.deepEqual(
        bought.rows.map((r) => [r.rate, r.qty, r.stockQty]),
        [[15000, 2, null]],
      );
      for (const path of [
        `/v1/parties/${supplier.id}/items`,
        `/v1/parties/${supplier.id}/items/${item.id}`,
      ]) {
        const refused = await call(sales, "GET", path);
        assert.equal(refused.statusCode, 403, `${path}: ${refused.body}`);
      }
      type Parties = { suppliers: Rate[] | null; customers: Rate[] | null };
      const forSales = await ok<Parties>(
        sales,
        "GET",
        `/v1/items/${item.id}/parties`,
      );
      assert.equal(forSales.suppliers, null);
      assert.equal(forSales.customers?.length, 1);
      const forOwner = await ok<Parties & { openingStock: { qty: number } }>(
        owner,
        "GET",
        `/v1/items/${item.id}/parties`,
      );
      assert.equal(forOwner.suppliers?.[0].stockQty, 8);
      assert.equal(forOwner.openingStock.qty, 0);

      // The lists can be downloaded for offline reading in one batch.
      const batch = await ok<{ results: { status: number }[] }>(
        owner,
        "POST",
        "/v1/reads/batch",
        {
          paths: [
            `/v1/parties/${supplier.id}/items`,
            `/v1/items/${item.id}/parties`,
          ],
        },
      );
      assert.deepEqual(
        batch.results.map((r) => r.status),
        [200, 200],
      );
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
