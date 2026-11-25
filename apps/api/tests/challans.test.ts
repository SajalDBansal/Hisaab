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
  "challans: the firm setting decides whether a challan moves stock; issued challans keep it (T04)",
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
        BETTER_AUTH_SECRET: "challan-fixture-only-secret-not-for-users-12345",
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
      const email = `challan-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Challan",
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
          name: `Challan ${tag}`,
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
      const stock = async () => {
        const lots = await ok<{ itemId: string; qty: number }[]>(
          "GET",
          "/v1/items/stock-lots",
        );
        return lots
          .filter((l) => l.itemId === item.id)
          .reduce((n, l) => n + l.qty, 0);
      };
      const challan = (challanType?: string) =>
        ok<
          V & { challanType?: string; challanStock?: boolean; version: number }
        >("POST", "/v1/orders/delivery-note", {
          partyId: customer.id,
          date: today,
          lines: sale(3),
          charges: [],
          ...(challanType ? { challanType } : {}),
        });
      const setting = (challanStock: boolean, version: number) =>
        app.inject({
          method: "PUT",
          url: "/v1/settings/sales-controls",
          headers: {
            ...headers,
            cookie,
            "x-firm-id": firmId,
            "if-match": String(version),
          },
          payload: { overdueSales: "warn", challanStock },
        });

      // Default: the challan moves stock, and billing it takes none again.
      const controls = await ok<{ challanStock: boolean; version: number }>(
        "GET",
        "/v1/settings/sales-controls",
      );
      assert.equal(controls.challanStock, true);
      const moved = await challan();
      assert.equal(moved.challanType, "supply");
      assert.equal(moved.challanStock, true);
      assert.equal(await stock(), 7);
      const billed = await fulfil(moved.id, "sale", 3);
      assert.equal(billed.vouchers.length, 1);
      assert.equal(await stock(), 7);

      // A challan type only belongs on a challan, and must be one of the list.
      const badType = await call("POST", "/v1/orders/delivery-note", {
        partyId: customer.id,
        date: today,
        lines: sale(1),
        charges: [],
        challanType: "gift",
      });
      assert.equal(badType.statusCode, 400, badType.body);
      const onOrder = await call("POST", "/v1/orders/sales-order", {
        partyId: customer.id,
        date: today,
        lines: sale(1),
        charges: [],
        challanType: "job-work",
      });
      assert.ok(onOrder.statusCode >= 400 && onOrder.statusCode < 500);

      // Off: paperwork only; the invoice made from it takes the stock.
      const off = await setting(false, controls.version);
      assert.equal(off.statusCode, 200, off.body);
      assert.equal(off.json().challanStock, false);
      const paper = await challan("approval");
      assert.equal(paper.challanStock, false);
      assert.equal(paper.challanType, "approval");
      assert.equal(await stock(), 7);
      await fulfil(paper.id, "sale", 2);
      assert.equal(await stock(), 5);

      // Switching back on does not re-book challans already issued.
      const on = await setting(true, off.json().version);
      assert.equal(on.statusCode, 200, on.body);
      assert.equal(await stock(), 5);
      const reread = await ok<{ challanStock?: boolean }>(
        "GET",
        `/v1/vouchers/${paper.id}`,
      );
      assert.equal(reread.challanStock, false);

      // Cancelling a stock challan returns its stock.
      const third = await challan("job-work");
      assert.equal(await stock(), 2);
      const cancel = await app.inject({
        method: "POST",
        url: `/v1/vouchers/${third.id}/cancel`,
        headers: {
          ...headers,
          cookie,
          "x-firm-id": firmId,
          "if-match": String(third.version),
        },
        payload: { reason: "Not sent" },
      });
      assert.equal(cancel.statusCode, 200, cancel.body);
      assert.equal(await stock(), 5);

      // The register shows purpose and where stock moves.
      const register = await ok<{
        sections: { rows: { cells: unknown[] }[] }[];
      }>("POST", "/v1/reports/export", {
        report: "delivery-notes-register",
        from: (await ok<{ fyStart: string }>("GET", "/v1/firms/current"))
          .fyStart,
        to: today,
        includeNarration: false,
        includeZeroBalances: false,
      });
      const text = JSON.stringify(register.sections);
      assert.ok(
        text.includes("Sale on approval") && text.includes("On invoice"),
      );
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
