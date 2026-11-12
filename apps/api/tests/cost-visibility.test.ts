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
  "sales staff never see or change purchase costs",
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
        BETTER_AUTH_SECRET: "cost-fixture-only-secret-not-used-by-accounts",
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
        const email = `cost-${tag}-${suffix}@example.invalid`;
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
          name: `Cost ${tag}`,
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
      // Sales staff can still sell; their sale saves its real cost.
      const [sale] = await ok<{ id: string }[]>(
        sales,
        "POST",
        "/v1/sales/split",
        {
          partyId: customer.id,
          date: today,
          lines: [{ itemId: item.id, qty: 2, rate: 15000, gstRate: 0 }],
          charges: [],
        },
      );

      type ItemRows = { items: { id: string; purchasePrice: number }[] };
      const listed = (page: ItemRows, id = item.id) => {
        const found = page.items.find((row) => row.id === id);
        assert.ok(found, `item ${id} listed`);
        return found;
      };
      type Lot = { itemId: string; value: number; unitCost: number };
      type Sale = {
        lines: { stockCost?: number }[];
        snapshot?: { items: { purchasePrice: number }[] };
      };

      // What sales staff see: no costs anywhere.
      assert.equal(
        listed(await ok(sales, "GET", "/v1/items")).purchasePrice,
        0,
      );
      const salesLots = await ok<Lot[]>(sales, "GET", "/v1/items/stock-lots");
      assert.ok(
        salesLots.every((lot) => lot.value === 0 && lot.unitCost === 0),
      );
      const salesView = await ok<Sale>(sales, "GET", `/v1/vouchers/${sale.id}`);
      assert.equal(salesView.lines[0].stockCost ?? 0, 0);
      assert.ok(salesView.snapshot?.items.every((i) => i.purchasePrice === 0));
      const batch = await ok<{ results: { body: unknown }[] }>(
        sales,
        "POST",
        "/v1/reads/batch",
        { paths: ["/v1/items/stock-lots", `/v1/vouchers/${sale.id}`] },
      );
      assert.ok(
        (batch.results[0].body as Lot[]).every((lot) => lot.value === 0),
      );
      assert.equal((batch.results[1].body as Sale).lines[0].stockCost ?? 0, 0);

      // The owner still sees the real costs, including the cost the sale froze.
      assert.equal(
        listed(await ok(owner, "GET", "/v1/items")).purchasePrice,
        10000,
      );
      const ownerView = await ok<Sale>(owner, "GET", `/v1/vouchers/${sale.id}`);
      assert.equal(ownerView.lines[0].stockCost, 20000);
      const ownerLots = await ok<Lot[]>(owner, "GET", "/v1/items/stock-lots");
      assert.equal(
        ownerLots
          .filter((lot) => lot.itemId === item.id)
          .reduce((s, l) => s + l.value, 0),
        80000,
      );

      // An item edit by sales staff keeps the purchase price and opening stock.
      await ok(
        sales,
        "PUT",
        `/v1/items/${item.id}`,
        { ...itemInput, purchasePrice: 1, salePrice: 16000 },
        { "if-match": `"${item.version}"` },
      );
      const edited = listed(await ok(owner, "GET", "/v1/items"));
      assert.equal(edited.purchasePrice, 10000);

      // New items from sales staff start without cost and can't carry opening stock.
      const withStock = await call(sales, "POST", "/v1/items", {
        ...itemInput,
        name: `Stocked ${tag}`,
        openingStock: 5,
      });
      assert.equal(withStock.statusCode, 403, withStock.body);
      const added = await ok<{ id: string }>(sales, "POST", "/v1/items", {
        ...itemInput,
        name: `Added ${tag}`,
        purchasePrice: 9999,
      });
      const fresh = listed(await ok(owner, "GET", "/v1/items"), added.id);
      assert.equal(fresh.purchasePrice, 0);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
