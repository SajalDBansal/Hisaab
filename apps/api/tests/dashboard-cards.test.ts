import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DashboardData,
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
  "dashboard cards: new figures in the one Home read, stock value only with cost rights (T63/T26)",
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
        BETTER_AUTH_SECRET: "dashboard-cards-fixture-only-secret-not-for-users",
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
        const email = `dash-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Dash ${suffix}`,
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
      const analyst = await account("analyst");
      const viewer = await account("viewer");
      const clerk = await account("clerk");
      let firmId = "";
      type Method = "GET" | "POST" | "PATCH";
      const call = (
        who: { cookie: string },
        method: Method,
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
      const ok = async <T>(
        who: { cookie: string },
        method: Method,
        path: string,
        payload?: object,
      ) => {
        const reply = await call(who, method, path, payload);
        assert.ok(
          reply.statusCode < 300,
          `${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.json<T>();
      };

      firmId = (
        await ok<{ id: string }>(owner, "POST", "/v1/firms", {
          name: `Dash ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstin: "07AAAAA0000A1Z4",
          gstRegistration: "regular",
        })
      ).id;
      const join = async (userId: string, role: string) => {
        await db
          .insert(schema.member)
          .values({ organizationId: firmId, userId, role });
        const [row] = await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, firmId),
              eq(schema.member.userId, userId),
            ),
          );
        return row.id;
      };
      const analystMember = await join(analyst.id, "viewer");
      await join(viewer.id, "viewer");
      await join(clerk.id, "sales");
      // Reports, but purchase rates hidden.
      const roles = await ok<{ custom: { id: string; name: string }[] }>(
        owner,
        "POST",
        "/v1/firms/current/roles",
        {
          name: "Analyst",
          rights: {
            permissions: ["reports"],
            vouchers: {},
            flags: {
              hidePurchaseRate: true,
              viewProfitMargin: false,
              ownRecordsOnly: false,
              viewAudit: false,
              restoreCancelled: false,
            },
          },
        },
      );
      const role = roles.custom.find((r) => r.name === "Analyst");
      assert.ok(role);
      await ok(owner, "PATCH", `/v1/firms/current/members/${analystMember}`, {
        role: role.id,
      });

      const party = (type: "customer" | "supplier", gstin = "") =>
        ok<{ id: string }>(owner, "POST", "/v1/parties", {
          name: `${type} ${tag}`,
          type,
          phone: "",
          city: "Delhi",
          stateCode: gstin ? gstin.slice(0, 2) : "07",
          gstin,
          creditDays: 30,
          creditLimit: 0,
          openingBalance: 0,
        });
      const supplier = await party("supplier", "09BBBBB1111B1ZL");
      const customer = await party("customer");
      const item = await ok<{ id: string }>(owner, "POST", "/v1/items", {
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
      const lines = (qty: number, rate: number) => [
        { itemId: item.id, qty, rate, gstRate: 5 },
      ];
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: lines(10, 10000),
        charges: [],
      });
      await ok(owner, "POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: lines(2, 15000),
        charges: [],
      });
      await ok(owner, "POST", "/v1/orders/estimate", {
        partyId: customer.id,
        date: today,
        lines: lines(3, 15000),
        charges: [],
      });

      const dashboard = (who: { cookie: string }) =>
        ok<DashboardData>(who, "GET", "/v1/reports/dashboard?tax=all");
      const d = await dashboard(owner);
      assert.ok(DashboardData.safeParse(d).success);
      // Fresh bills: nothing near the 180-day limit yet, but the card is there.
      assert.deepEqual(d.itcAtRisk, {
        amount: 0,
        bills: 0,
        reverseNow: 0,
        reverseNowBills: 0,
        nextLimit: null,
        topSupplier: null,
      });
      assert.equal(d.topCustomers[0]?.partyId, customer.id);
      assert.equal(d.topSuppliers[0]?.partyId, supplier.id);
      assert.equal(d.openOrders.find((o) => o.type === "estimate")?.count, 1);
      assert.equal(d.receivablesAgeing["0-30"], d.toCollect);
      assert.equal(d.payablesDue.overdue, 0);
      assert.equal(d.quietCustomers.count, 0);
      assert.ok(d.stockValue > 0);

      // Viewers see costs; a role with purchase rates hidden gets no stock value.
      assert.equal((await dashboard(viewer)).stockValue, d.stockValue);
      const hidden = await dashboard(analyst);
      assert.equal(hidden.stockValue, 0);
      assert.equal(hidden.toPay, d.toPay);
      // Same right as before: no reports, no dashboard.
      const refused = await call(clerk, "GET", "/v1/reports/dashboard");
      assert.equal(refused.statusCode, 403, refused.body);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
