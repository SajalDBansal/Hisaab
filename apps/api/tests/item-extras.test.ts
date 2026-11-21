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
  "item extras: services, min/max, not for sale, stock policy and expiry (T37-T39)",
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
        BETTER_AUTH_SECRET: "item-extras-fixture-only-secret-not-for-users",
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
      const email = `items-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Items",
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
      const call = (
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
            cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...extra,
            ...(method !== "GET"
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
          name: `Items ${tag}`,
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
      const today = new Date().toISOString().slice(0, 10);
      const plus = (days: number) =>
        new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const newItem = (over: object) =>
        call("POST", "/v1/items", {
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
          ...over,
        });
      type Row = {
        id: string;
        version: number;
        kind?: string;
        tags?: string[];
        maxStock?: number;
        notForSale?: boolean;
        stock: number;
        lowStock: boolean;
        overStock?: boolean;
      };

      // A service: SAC code (99...), no stock; refused with an HSN-looking code.
      const badSac = await newItem({
        name: `Bad ${tag}`,
        kind: "service",
        hsn: "1006",
      });
      assert.equal(badSac.statusCode, 400, badSac.body);
      assert.match(badSac.json().error.fields.hsn, /99/);
      const serviceReply = await newItem({
        name: `Repair ${tag}`,
        kind: "service",
        hsn: "998719",
        tags: ["Labour"],
      });
      assert.equal(serviceReply.statusCode, 201, serviceReply.body);
      const service = serviceReply.json<Row>();
      assert.equal(service.kind, "service");
      assert.deepEqual(service.tags, ["Labour"]);

      // Sold with no purchase: no lot, no stock movement.
      const [serviceSale] = await ok<
        { id: string; lines: { stockLotId?: string }[] }[]
      >("POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: service.id, qty: 2, rate: 50000, gstRate: 5 }],
        charges: [],
      });
      assert.equal(serviceSale.lines[0].stockLotId, undefined);
      const serviceDetail = await ok<{ qty: number; movements: unknown[] }>(
        "GET",
        `/v1/items/${service.id}`,
      );
      assert.equal(serviceDetail.qty, 0);
      assert.deepEqual(serviceDetail.movements, []);
      // Its kind is fixed once used.
      const toGoods = await call(
        "PUT",
        `/v1/items/${service.id}`,
        {
          name: `Repair ${tag}`,
          code: "",
          hsn: "998719",
          group: "",
          taxType: "taxable",
          gstRate: 5,
          unit: "Pcs",
          purchasePrice: 10000,
          salePrice: 15000,
          mrp: 0,
          reorderLevel: 0,
          openingStock: 0,
          kind: "goods",
        },
        { "if-match": String(service.version) },
      );
      assert.equal(toGoods.statusCode, 409, toGoods.body);
      assert.equal(toGoods.json().error.code, "ITEM_IN_USE");

      // Goods with min 3 and max 5, not for sale, bought with a batch and expiry.
      const goodsReply = await newItem({
        name: `Oil ${tag}`,
        reorderLevel: 3,
        maxStock: 5,
        notForSale: true,
        tags: ["Fast moving"],
      });
      assert.equal(goodsReply.statusCode, 201, goodsReply.body);
      const goods = goodsReply.json<Row>();
      assert.equal(goods.maxStock, 5);
      assert.equal(goods.notForSale, true);
      assert.equal(goods.lowStock, true);
      await ok("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [
          {
            itemId: goods.id,
            qty: 8,
            rate: 10000,
            gstRate: 5,
            batchNumber: "B-77",
            expiryDate: plus(10),
          },
        ],
        charges: [],
      });
      const lots = await ok<
        { itemId: string; batchNumber?: string; expiryDate?: string }[]
      >("GET", "/v1/items/stock-lots");
      assert.deepEqual(
        lots
          .filter((l) => l.itemId === goods.id && l.batchNumber)
          .map((l) => [l.batchNumber, l.expiryDate]),
        [["B-77", plus(10)]],
      );
      const over = await ok<{
        items: Row[];
        summary: { overCount?: number; tags?: string[] };
      }>("GET", "/v1/items/page?over=true");
      assert.deepEqual(
        over.items.map((r) => r.id),
        [goods.id],
      );
      assert.equal(over.items[0].overStock, true);
      assert.deepEqual(over.summary.tags, ["Fast moving", "Labour"]);
      const tagged = await ok<{ items: Row[] }>(
        "GET",
        `/v1/items/page?tag=${encodeURIComponent("labour")}`,
      );
      assert.deepEqual(
        tagged.items.map((r) => r.id),
        [service.id],
      );

      // Expiring items report: the lot expiring in 10 days.
      const current = await ok<{ fyStart: string }>("GET", "/v1/firms/current");
      const doc = await ok<{
        sections: { rows: { cells: unknown[]; total?: boolean }[] }[];
      }>("POST", "/v1/reports/export", {
        report: "expiring-items",
        from: current.fyStart,
        to: today,
        includeNarration: false,
        includeZeroBalances: false,
        expiryDays: 30,
      });
      const rows = doc.sections[0].rows.filter((r) => !r.total);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].cells[3], "B-77");
      assert.equal(rows[0].cells[1], "In 10 days");

      // Stock control: block refuses a new sale leaving less than the minimum.
      const controls = await ok<{ stockPolicy: string; version: number }>(
        "GET",
        "/v1/settings/sales-controls",
      );
      assert.equal(controls.stockPolicy, "warn");
      const put = await call(
        "PUT",
        "/v1/settings/sales-controls",
        { overdueSales: "warn", stockPolicy: "block" },
        { "if-match": String(controls.version) },
      );
      assert.equal(put.statusCode, 200, put.body);
      assert.equal(put.json().stockPolicy, "block");
      const sell = (qty: number) =>
        call("POST", "/v1/sales/split", {
          partyId: customer.id,
          date: today,
          lines: [{ itemId: goods.id, qty, rate: 15000, gstRate: 5 }],
          charges: [],
        });
      const refused = await sell(6);
      assert.equal(refused.statusCode, 400, refused.body);
      assert.match(refused.json().error.message, /below its minimum stock/);
      assert.equal((await sell(5)).statusCode, 201);
      // An older app sending only the overdue policy keeps the stock policy.
      const keep = await call(
        "PUT",
        "/v1/settings/sales-controls",
        { overdueSales: "off" },
        { "if-match": String(put.json().version) },
      );
      assert.equal(keep.json().stockPolicy, "block");
      // Never below zero, under either policy (FIFO).
      assert.equal((await sell(4)).statusCode, 400);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
