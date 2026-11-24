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
  "credit control: the overdue policy blocks new sales until the owner approves (T11)",
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
        BETTER_AUTH_SECRET: "credit-control-fixture-only-secret-not-for-users",
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
      const email = `credit-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Credit",
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
      const cookies = verify.headers["set-cookie"];
      const cookie = (Array.isArray(cookies) ? cookies : [String(cookies)])
        .map((c) => c.split(";")[0])
        .join("; ");
      let firmId = "";
      const call = (method: "GET" | "POST", path: string, payload?: object) =>
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
      const firm = await ok<{ id: string; fyStart?: string }>(
        "POST",
        "/v1/firms",
        {
          name: `Credit ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstin: "07AAAAA0000A1Z4",
          gstRegistration: "regular",
        },
      );
      firmId = firm.id;
      const party = (type: "customer" | "supplier", gstin = "", name = type) =>
        ok<{ id: string }>("POST", "/v1/parties", {
          name: `${name} ${tag}`,
          type,
          phone: "",
          city: "Delhi",
          stateCode: gstin ? gstin.slice(0, 2) : "07",
          gstin,
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        });
      const supplier = await party("supplier", "09BBBBB1111B1ZL");
      const customer = await party("customer");
      const item = await ok<{ id: string }>("POST", "/v1/items", {
        name: `Item ${tag}`,
        code: "",
        hsn: "1006",
        group: "",
        taxType: "taxable",
        gstRate: 5,
        unit: "Pcs",
        purchasePrice: 10000,
        salePrice: 15000,
        mrp: 0,
        reorderLevel: 0,
        openingStock: 0,
      });
      const today = new Date().toISOString().slice(0, 10);
      const back = new Date(Date.now() - 2 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { fyStart } = await ok<{ fyStart: string }>(
        "GET",
        "/v1/firms/current",
      );
      // A bill two days old with no credit days is overdue; not possible on 1-2 April.
      if (back < fyStart) return;
      await ok("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: back,
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 5 }],
        charges: [],
      });
      const bill = (partyId: string, date = today) => ({
        partyId,
        date,
        lines: [{ itemId: item.id, qty: 1, rate: 15000, gstRate: 5 }],
        charges: [],
      });
      const saleCall = (body: object) => call("POST", "/v1/sales/split", body);

      // Two days old, no credit days: overdue now.
      await ok("POST", "/v1/sales/split", bill(customer.id, back));

      // Default policy "warn": the sale goes through.
      const controls = await ok<{ overdueSales: string; version: number }>(
        "GET",
        "/v1/settings/sales-controls",
      );
      assert.deepEqual(controls, {
        overdueSales: "warn",
        stockPolicy: "warn",
        challanStock: true,
        version: 0,
      });
      assert.equal((await saleCall(bill(customer.id))).statusCode, 201);

      // Switch to "block" (stale version refused first).
      const put = (version: number) =>
        app.inject({
          method: "PUT",
          url: "/v1/settings/sales-controls",
          headers: {
            ...headers,
            cookie,
            "x-firm-id": firmId,
            "if-match": String(version),
          },
          payload: { overdueSales: "block" },
        });
      assert.equal((await put(5)).statusCode, 409);
      const saved = await put(0);
      assert.equal(saved.statusCode, 200, saved.body);
      assert.deepEqual(saved.json(), {
        overdueSales: "block",
        stockPolicy: "warn",
        challanStock: true,
        version: 1,
      });

      // Now a new sale needs the owner's approval for that exact sale.
      const blocked = await saleCall(bill(customer.id));
      assert.equal(blocked.statusCode, 409, blocked.body);
      assert.equal(blocked.json().error.code, "OVERDUE_BILLS");
      const approval = await ok<{ id: string }>(
        "POST",
        "/v1/settlements/credit-approvals",
        { sale: bill(customer.id), reason: "Promised to pay on Friday" },
      );
      // The approval is for that sale only.
      const other = await saleCall({
        ...bill(customer.id),
        lines: [{ itemId: item.id, qty: 2, rate: 15000, gstRate: 5 }],
        creditOverrideId: approval.id,
      });
      assert.equal(other.statusCode, 409, other.body);
      const approved = await saleCall({
        ...bill(customer.id),
        creditOverrideId: approval.id,
      });
      assert.equal(approved.statusCode, 201, approved.body);
      // And once only.
      const again = await saleCall({
        ...bill(customer.id),
        creditOverrideId: approval.id,
      });
      assert.equal(again.statusCode, 409, again.body);

      // A customer with nothing overdue is not blocked, and a back-dated
      // sale is not overdue against itself.
      const fresh = await party("customer", "", "fresh");
      assert.equal((await saleCall(bill(fresh.id, back))).statusCode, 201);
      const clean = await party("customer", "", "clean");
      assert.equal((await saleCall(bill(clean.id))).statusCode, 201);
      const needless = await call("POST", "/v1/settlements/credit-approvals", {
        sale: bill(clean.id),
        reason: "Not needed",
      });
      assert.equal(needless.statusCode, 422, needless.body);

      // Money received for the overdue bills lifts the block.
      const [cash] = await ok<{ id: string }[]>("GET", "/v1/ledgers?kind=cash");
      await ok("POST", "/v1/receipts", {
        partyId: customer.id,
        date: today,
        amount: 100_000,
        mode: "cash",
        ledgerId: cash.id,
        allocations: [],
      });
      assert.equal((await saleCall(bill(customer.id))).statusCode, 201);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
