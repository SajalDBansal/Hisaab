import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "batched reads answer exactly like single reads, within the caller's access",
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
        BETTER_AUTH_SECRET: "batch-fixture-only-secret-not-used-by-accounts",
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
        const email = `batch-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Batch ${suffix}`,
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
        return (Array.isArray(cookies) ? cookies : [String(cookies)])
          .map((c) => c.split(";")[0])
          .join("; ");
      }
      const owner = await account("owner");
      const outsider = await account("outsider");
      let firmId = "";
      const call = (
        method: "GET" | "POST",
        path: string,
        payload?: object,
        cookie = owner,
      ) =>
        app.inject({
          method,
          url: path,
          headers: {
            ...headers,
            cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...(method === "POST"
              ? { "idempotency-key": newRequestId(randomUUID()) }
              : {}),
          },
          payload,
        });
      const ok = async <T>(
        method: "GET" | "POST",
        path: string,
        payload?: object,
      ) => {
        const reply = await call(method, path, payload);
        assert.ok(
          reply.statusCode < 300,
          `${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.json<T>();
      };

      firmId = (
        await ok<{ id: string }>("POST", "/v1/firms", {
          name: `Batch ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      const party = (type: "customer" | "supplier") =>
        ok<{ id: string }>("POST", "/v1/parties", {
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
      const item = await ok<{ id: string }>("POST", "/v1/items", {
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
      const purchase = await ok<{ id: string }>("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const [sale] = await ok<{ id: string }[]>("POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: item.id, qty: 3, rate: 15000, gstRate: 0 }],
        charges: [],
      });

      const paths = [
        "/v1/firms/current",
        "/v1/settings/invoice",
        "/v1/units",
        "/v1/parties",
        "/v1/parties?type=customer",
        `/v1/parties/${customer.id}`,
        `/v1/parties/${supplier.id}`,
        "/v1/items",
        `/v1/items/${item.id}`,
        `/v1/items/lots?date=${today}`,
        "/v1/vouchers",
        `/v1/vouchers/${purchase.id}`,
        `/v1/vouchers/${sale.id}`,
        `/v1/vouchers/${sale.id}/returnable`,
        "/v1/reports/dashboard?tax=all",
        "/v1/reports/stock?tax=all",
        "/v1/reports/outstanding?type=customer&tax=all",
        "/v1/reports/trial-balance?tax=all",
        "/v1/reports/final-accounts?tax=all",
        "/v1/accounts/chart?tax=all",
        "/v1/gst/months?count=2",
      ];
      const single = [];
      for (const path of paths) single.push(await call("GET", path));
      const batch = await ok<{
        results: {
          path: string;
          status: number;
          format: string;
          body: unknown;
        }[];
      }>("POST", "/v1/reads/batch", { paths });
      assert.equal(batch.results.length, paths.length);
      batch.results.forEach((result, index) => {
        const reply = single[index];
        assert.equal(result.path, paths[index]);
        assert.equal(result.status, reply.statusCode, result.path);
        assert.deepEqual(
          result.body,
          result.format === "json" ? reply.json() : reply.body,
          result.path,
        );
      });

      // Paths outside book reads, or that render files, are refused per path.
      const refused = await ok<{ results: { status: number }[] }>(
        "POST",
        "/v1/reads/batch",
        {
          paths: [
            `/v1/vouchers/${sale.id}/pdf`,
            "/api/auth/get-session",
            "/v1/reports/export?report=stock",
          ],
        },
      );
      assert.deepEqual(
        refused.results.map((r) => r.status),
        [400, 400, 400],
      );

      // Another account can't read this firm through a batch.
      const foreign = await call(
        "POST",
        "/v1/reads/batch",
        { paths: ["/v1/parties"] },
        outsider,
      );
      assert.equal(foreign.statusCode, 403);

      // 400 reads in two batches stay within the 300-a-minute limit: each batch counts once.
      for (let round = 0; round < 2; round++) {
        const many = await ok<{ results: { status: number }[] }>(
          "POST",
          "/v1/reads/batch",
          {
            paths: Array.from(
              { length: 200 },
              () => `/v1/parties/${customer.id}`,
            ),
          },
        );
        assert.ok(many.results.every((r) => r.status === 200));
      }
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
