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
  "proforma: estimate to proforma to sale through order fulfilment, no postings until the sale",
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
        BETTER_AUTH_SECRET: "proforma-fixture-only-secret-not-for-users-1234",
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
      const email = `proforma-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Proforma",
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
          name: `Proforma ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstin: "07AAAAA0000A1Z4",
          gstRegistration: "regular",
        },
      );
      firmId = firm.id;
      const party = (type: "customer" | "supplier", gstin = "") =>
        ok<{ id: string }>("POST", "/v1/parties", {
          name: `${type} ${tag}`,
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
      await ok("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 5 }],
        charges: [],
      });
      const sale = (qty: number) => [
        { itemId: item.id, qty, rate: 15000, gstRate: 5 },
      ];
      type V = { id: string; number: string; type: string; amount: number };
      type Detail = {
        source: { version: number; status: string };
        targets: string[];
        lines: { id: string; remainingQty: number }[];
      };
      const fulfil = async (id: string, target: string, qty: number) => {
        const detail = await ok<Detail>("GET", `/v1/orders/${id}/fulfillment`);
        assert.ok(detail.targets.includes(target), detail.targets.join());
        return ok<{ vouchers: V[] }>("POST", `/v1/orders/${id}/fulfill`, {
          version: detail.source.version,
          target,
          date: today,
          lines: [{ sourceLineId: detail.lines[0].id, qty }],
        });
      };

      // A supplier can't get a proforma.
      const wrong = await call("POST", "/v1/orders/proforma", {
        partyId: supplier.id,
        date: today,
        lines: sale(1),
        charges: [],
      });
      assert.ok(wrong.statusCode >= 400 && wrong.statusCode < 500, wrong.body);

      const estimate = await ok<V>("POST", "/v1/orders/estimate", {
        partyId: customer.id,
        date: today,
        lines: sale(4),
        charges: [],
      });
      // Part of the estimate goes on a proforma.
      const [proforma] = (await fulfil(estimate.id, "proforma", 3)).vouchers;
      assert.equal(proforma.type, "proforma");
      assert.match(proforma.number, /^PF\//);
      assert.equal(proforma.amount, 47300); // 3 × ₹150 + 5% GST, rounded to the rupee
      const partly = await ok<Detail>(
        "GET",
        `/v1/orders/${estimate.id}/fulfillment`,
      );
      assert.equal(partly.source.status, "partial");
      assert.equal(partly.lines[0].remainingQty, 1);

      const listed = await ok<{ voucher: { id: string }; status: string }[]>(
        "GET",
        "/v1/vouchers/orders?type=proforma",
      );
      assert.equal(
        listed.find((o) => o.voucher.id === proforma.id)?.status,
        "open",
      );

      // Nothing in the books yet: the customer owes nothing.
      const owed = async () => {
        const party = await ok<{ balance: number }>(
          "GET",
          `/v1/parties/${customer.id}`,
        );
        return party.balance;
      };
      assert.equal(await owed(), 0);

      // A proforma only becomes a sale.
      const proformaDetail = await ok<Detail>(
        "GET",
        `/v1/orders/${proforma.id}/fulfillment`,
      );
      assert.deepEqual(proformaDetail.targets, ["sale"]);
      const [bill] = (await fulfil(proforma.id, "sale", 3)).vouchers;
      assert.equal(bill.type, "sale");
      assert.equal(bill.amount, 47300);
      assert.equal(await owed(), 47300);
      const done = await ok<Detail>(
        "GET",
        `/v1/orders/${proforma.id}/fulfillment`,
      );
      assert.equal(done.source.status, "converted");
      assert.deepEqual(done.targets, []);

      const register = await ok<{ sections: unknown[] }>(
        "POST",
        "/v1/reports/export",
        {
          report: "proformas-register",
          from: (await ok<{ fyStart: string }>("GET", "/v1/firms/current"))
            .fyStart,
          to: today,
          includeNarration: false,
          includeZeroBalances: false,
        },
      );
      const text = JSON.stringify(register.sections);
      assert.ok(text.includes(proforma.number) && text.includes("Converted"));
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
