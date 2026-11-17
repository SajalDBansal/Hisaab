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
  "custom roles: the matrix, own records only, hidden costs and live edits",
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
        BETTER_AUTH_SECRET: "custom-roles-fixture-only-secret-not-for-users",
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
        const email = `roles-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Roles ${suffix}`,
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
      const counter = await account("counter");
      let firmId = "";
      type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      const call = (
        who: { cookie: string },
        method: Method,
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
        method: Method,
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
          name: `Roles ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: counter.id, role: "sales" });
      const [member] = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, firmId),
            eq(schema.member.userId, counter.id),
          ),
        );

      const flags = {
        hidePurchaseRate: true,
        viewProfitMargin: false,
        ownRecordsOnly: true,
        viewAudit: false,
        restoreCancelled: false,
      };
      const rights = (saleActions: string[]) => ({
        permissions: ["sales"],
        vouchers: { sale: saleActions, receipt: ["view", "create"] },
        flags,
      });

      // A matrix that changes purchases without the purchase module is refused.
      const bad = await call(owner, "POST", "/v1/firms/current/roles", {
        name: "Bad",
        rights: {
          ...rights(["view"]),
          vouchers: { purchase: ["view", "create"] },
        },
      });
      assert.equal(bad.statusCode, 400, bad.body);

      type Roles = {
        custom: {
          id: string;
          name: string;
          version: number;
          members: number;
        }[];
      };
      const created = await ok<Roles>(
        owner,
        "POST",
        "/v1/firms/current/roles",
        {
          name: "Counter staff",
          rights: rights(["view", "create"]),
        },
      );
      const role = created.custom.find((r) => r.name === "Counter staff");
      assert.ok(role);
      assert.match(role.id, /^r_/);
      await ok(owner, "PATCH", `/v1/firms/current/members/${member.id}`, {
        role: role.id,
      });

      // Setup by the owner: a supplier, an item with stock, a customer and an owner's sale.
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
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const sell = (who: { cookie: string }) =>
        call(who, "POST", "/v1/sales/split", {
          partyId: customer.id,
          date: today,
          lines: [{ itemId: item.id, qty: 1, rate: 15000, gstRate: 0 }],
          charges: [],
        });
      const ownersSale = (await sell(owner)).json<{ id: string }[]>()[0];

      // The counter role sells, but can't buy.
      const mine = await sell(counter);
      assert.equal(mine.statusCode, 201, mine.body);
      const [mySale] = mine.json<{ id: string; version: number }[]>();
      const buy = await call(counter, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 1, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      assert.equal(buy.statusCode, 403, buy.body);

      // Only own records: the owner's sale is hidden, in lists and in detail.
      const page = await ok<{ items: { voucher: { id: string } }[] }>(
        counter,
        "GET",
        "/v1/vouchers/invoices/page?type=sale&limit=50",
      );
      assert.deepEqual(
        page.items.map((row) => row.voucher.id),
        [mySale.id],
      );
      assert.equal(
        (await call(counter, "GET", `/v1/vouchers/${ownersSale.id}`))
          .statusCode,
        403,
      );
      assert.equal(
        (await call(counter, "GET", `/v1/vouchers/${mySale.id}`)).statusCode,
        200,
      );

      // Purchase costs are hidden from this role.
      const items = await ok<{
        items: { id: string; purchasePrice: number }[];
      }>(counter, "GET", "/v1/items");
      assert.equal(items.items.find((i) => i.id === item.id)?.purchasePrice, 0);

      // No cancel right yet …
      const cancel = () =>
        call(
          counter,
          "POST",
          `/v1/vouchers/${mySale.id}/cancel`,
          { reason: "Wrong item" },
          { "if-match": String(mySale.version) },
        );
      assert.equal((await cancel()).statusCode, 403);

      // … the owner adds it, and it applies at once (no new login).
      await ok(
        owner,
        "PUT",
        `/v1/firms/current/roles/${role.id.slice(2)}`,
        { name: "Counter staff", rights: rights(["view", "create", "cancel"]) },
        { "if-match": String(role.version) },
      );
      const cancelled = await cancel();
      assert.equal(cancelled.statusCode, 200, cancelled.body);

      // A role in use can't be deleted.
      const del = await call(
        owner,
        "DELETE",
        `/v1/firms/current/roles/${role.id.slice(2)}`,
      );
      assert.equal(del.statusCode, 409, del.body);

      // The member list shows the custom role, not "viewer".
      const members = await ok<{ userId: string; role: string }[]>(
        owner,
        "GET",
        "/v1/firms/current/members",
      );
      assert.equal(members.find((m) => m.userId === counter.id)?.role, role.id);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
