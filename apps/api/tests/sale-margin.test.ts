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
  "sale margin: owner and accountant see it, sales staff never, custom roles without costs (T12)",
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
        BETTER_AUTH_SECRET: "sale-margin-fixture-only-secret-not-for-users",
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
        const email = `margin-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Margin ${suffix}`,
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
      const accountant = await account("accountant");
      const counter = await account("counter");
      let firmId = "";
      type Method = "GET" | "POST" | "PATCH";
      const call = (
        who: { cookie: string },
        method: Method,
        path: string,
        payload?: object,
        key = true,
      ) =>
        app.inject({
          method,
          url: path,
          headers: {
            ...headers,
            cookie: who.cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...(method === "POST" && key
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
          name: `Margin ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      for (const [who, role] of [
        [sales, "sales"],
        [accountant, "accountant"],
        [counter, "sales"],
      ] as const)
        await db
          .insert(schema.member)
          .values({ organizationId: firmId, userId: who.id, role });
      const [member] = await db
        .select({ id: schema.member.id })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, firmId),
            eq(schema.member.userId, counter.id),
          ),
        );
      // A custom role that sees margins but not purchase rates.
      const created = await ok<{ custom: { id: string; name: string }[] }>(
        owner,
        "POST",
        "/v1/firms/current/roles",
        {
          name: "Counter with margin",
          rights: {
            permissions: ["sales"],
            vouchers: { sale: ["view", "create"] },
            flags: {
              hidePurchaseRate: true,
              viewProfitMargin: true,
              ownRecordsOnly: false,
              viewAudit: false,
              restoreCancelled: false,
            },
          },
        },
      );
      const role = created.custom.find((r) => r.name === "Counter with margin");
      assert.ok(role);
      await ok(owner, "PATCH", `/v1/firms/current/members/${member.id}`, {
        role: role.id,
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
      // Two batches: 5 at Rs 100, then 5 at Rs 120.
      for (const rate of [10000, 12000])
        await ok(owner, "POST", "/v1/purchases", {
          partyId: supplier.id,
          date: today,
          lines: [{ itemId: item.id, qty: 5, rate, gstRate: 0 }],
          charges: [],
        });
      const draft = (qty: number, extra: object = {}) => ({
        date: today,
        lines: [
          {
            itemId: item.id,
            qty,
            rate: 15000,
            gstRate: 0,
            discountPercent: 10,
          },
        ],
        ...extra,
      });
      type Figures = {
        taxable: number;
        cost: number | null;
        margin: number | null;
        marginPercent: number | null;
      };
      type Margin = {
        lines: (Figures & { problem?: string })[];
        total: Figures;
        missing: number;
      };
      // A read: no request key needed.
      const margin = (who: { cookie: string }, payload: object) =>
        call(who, "POST", "/v1/sales/margin", payload, false);

      // Owner: 7 x Rs 150 less 10% = Rs 945 taxable; cost 5 x 100 + 2 x 120 = Rs 740.
      const mine = await margin(owner, draft(7));
      assert.equal(mine.statusCode, 200, mine.body);
      const seen = mine.json<Margin>();
      assert.deepEqual(seen.lines[0], {
        taxable: 94500,
        cost: 74000,
        margin: 20500,
        marginPercent: 21.69,
      });
      assert.deepEqual(seen.total, seen.lines[0]);
      assert.equal(seen.missing, 0);

      // Nothing was saved: the sale saved now records the same cost.
      const [sale] = await ok<
        {
          id: string;
          lines: { stockCost?: number; stockLotId?: string; qty: number }[];
        }[]
      >(owner, "POST", "/v1/sales/split", {
        ...draft(7),
        partyId: customer.id,
        charges: [],
      });
      assert.equal(
        sale.lines.reduce((sum, l) => sum + (l.stockCost ?? 0), 0),
        74000,
      );

      // Editing that sale (its rows, one per batch, as the form keeps them)
      // may reuse its own stock; a new sale finds only 3 left.
      const edit = await margin(owner, {
        date: today,
        editingId: sale.id,
        lines: sale.lines.map((l) => ({
          itemId: item.id,
          stockLotId: l.stockLotId,
          qty: l.qty,
          rate: 15000,
          gstRate: 0,
          discountPercent: 10,
        })),
      });
      assert.equal(edit.statusCode, 200, edit.body);
      assert.equal(edit.json<Margin>().total.cost, 74000);
      const short = (await margin(owner, draft(7))).json<Margin>();
      assert.equal(short.lines[0].cost, null);
      assert.ok(short.lines[0].problem);
      assert.equal(short.missing, 1);

      // The accountant sees margins and costs.
      const books = await margin(accountant, draft(2));
      assert.equal(books.statusCode, 200, books.body);
      assert.equal(books.json<Margin>().total.cost, 24000);

      // Built-in sales staff never see margins (doc 33 R1).
      const refused = await margin(sales, draft(2));
      assert.equal(refused.statusCode, 403, refused.body);

      // A custom role with the right sees the margin, never the cost.
      const counterView = await margin(counter, draft(2));
      assert.equal(counterView.statusCode, 200, counterView.body);
      const counted = counterView.json<Margin>();
      assert.equal(counted.lines[0].cost, null);
      assert.equal(counted.total.cost, null);
      assert.equal(counted.total.margin, 27000 - 24000);

      // Unknown bills aren't readable; bad lines are refused.
      const stranger = await margin(
        owner,
        draft(1, { editingId: randomUUID() }),
      );
      assert.equal(stranger.statusCode, 404, stranger.body);
      const empty = await margin(owner, { date: today, lines: [] });
      assert.equal(empty.statusCode, 400, empty.body);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
