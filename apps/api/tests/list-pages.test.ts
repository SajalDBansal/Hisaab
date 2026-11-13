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
  "every list screen reads a page at a time, with totals over all rows",
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
        BETTER_AUTH_SECRET: "pages-fixture-only-secret-not-used-by-accounts",
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
        const email = `pages-${tag}-${suffix}@example.invalid`;
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
          name: `Pages ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: sales.id, role: "sales" });
      const party = (type: "customer" | "supplier", name: string) =>
        ok<{ id: string }>(owner, "POST", "/v1/parties", {
          name,
          type,
          phone: "",
          city: "Delhi",
          stateCode: "07",
          gstin: "",
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        });
      const supplier = await party("supplier", `Supplier ${tag}`);
      const customers: { id: string }[] = [];
      for (let i = 0; i < 24; i++)
        customers.push(
          await party(
            "customer",
            `Customer ${String(i).padStart(2, "0")} ${tag}`,
          ),
        );
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
        lines: [{ itemId: item.id, qty: 100, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      for (let i = 0; i < 12; i++)
        await ok(sales, "POST", "/v1/sales/split", {
          partyId: customers[i].id,
          date: today,
          lines: [{ itemId: item.id, qty: 1, rate: 15000 + i, gstRate: 0 }],
          charges: [],
        });

      type Page<T, S = unknown> = {
        items: T[];
        nextCursor: string | null;
        total: number;
        summary: S;
      };
      /** Follows nextCursor from the first page to the last. */
      async function walk<T>(who: { cookie: string }, path: string) {
        const all: T[] = [];
        let cursor: string | null = null;
        let first: Page<T> | undefined;
        do {
          const sep = path.includes("?") ? "&" : "?";
          const page: Page<T> = await ok<Page<T>>(
            who,
            "GET",
            cursor ? `${path}${sep}cursor=${cursor}` : path,
          );
          first ??= page;
          all.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);
        return { all, first: first as Page<T> };
      }

      // Parties: pages of 10, no repeats, every customer once, name order.
      type PartyRow = { id: string; name: string; balance: number };
      const paged = await walk<PartyRow>(
        owner,
        "/v1/parties/page?type=customer&sort=name&limit=10",
      );
      assert.equal(paged.first.total, 24);
      assert.equal(paged.first.items.length, 10);
      const names = paged.all.map((r) => r.name);
      assert.equal(new Set(names).size, 24);
      assert.deepEqual(names, [...names].sort());
      const summary = paged.first.summary as { receivable: number };
      assert.equal(
        summary.receivable,
        paged.all.reduce((s, r) => s + Math.max(r.balance, 0), 0),
      );
      const found = await ok<Page<PartyRow>>(
        owner,
        "GET",
        `/v1/parties/page?search=${encodeURIComponent(`Customer 07 ${tag}`)}`,
      );
      assert.deepEqual(
        found.items.map((r) => r.name),
        [`Customer 07 ${tag}`],
      );
      const withBalance = await ok<Page<PartyRow>>(
        owner,
        "GET",
        "/v1/parties/page?type=customer&withBalance=true",
      );
      assert.equal(withBalance.total, 12);

      // Sales staff: customers only, and no stock value at cost.
      const forSales = await ok<Page<{ type: string }>>(
        sales,
        "GET",
        "/v1/parties/page?limit=200",
      );
      assert.ok(forSales.items.every((r) => r.type === "customer"));
      const refused = await call(
        sales,
        "GET",
        "/v1/parties/page?type=supplier",
      );
      assert.equal(refused.statusCode, 403);
      type ItemPage = Page<{ value: number }, { value: number }>;
      const itemsForSales = await ok<ItemPage>(sales, "GET", "/v1/items/page");
      assert.equal(itemsForSales.summary.value, 0);
      assert.ok(itemsForSales.items.every((r) => r.value === 0));
      const itemsForOwner = await ok<ItemPage>(owner, "GET", "/v1/items/page");
      assert.equal(itemsForOwner.summary.value, 88 * 10000);

      // Sales invoices: every page, totals over all of them.
      type Invoice = { voucher: { id: string; amount: number } };
      const invoices = await walk<Invoice>(
        owner,
        "/v1/vouchers/invoices/page?type=sale&month=all&limit=5",
      );
      assert.equal(invoices.all.length, 12);
      assert.equal(new Set(invoices.all.map((r) => r.voucher.id)).size, 12);
      const totals = invoices.first.summary as {
        amount: number;
        counts: Record<string, number>;
      };
      assert.equal(
        totals.amount,
        invoices.all.reduce((s, r) => s + r.voucher.amount, 0),
      );
      assert.equal(totals.counts.unpaid, 12);

      // One party's entries; the day book; orders with nothing in them.
      const own = await ok<Page<{ partyId: string }>>(
        owner,
        "GET",
        `/v1/vouchers/page?partyId=${customers[3].id}`,
      );
      assert.deepEqual(
        own.items.map((v) => v.partyId),
        [customers[3].id],
      );
      const daybook = await walk<{ id: string }>(
        owner,
        "/v1/vouchers/page?limit=4",
      );
      assert.equal(daybook.all.length, 13);
      const orders = await ok<Page<unknown, { all: number }>>(
        owner,
        "GET",
        "/v1/vouchers/orders/page?type=estimate",
      );
      assert.equal(orders.summary.all, 0);

      // Edit log, item movements and a statement page.
      const audit = await ok<Page<unknown, { all: number }>>(
        owner,
        "GET",
        "/v1/audit-log/page?limit=5",
      );
      assert.equal(audit.items.length, 5);
      assert.ok(audit.summary.all >= 13);
      const movements = await walk<{ voucherId: string }>(
        owner,
        `/v1/items/${item.id}/movements?limit=5`,
      );
      assert.equal(movements.all.length, 13);
      const ledgers = await ok<{ id: string; kind: string }[]>(
        owner,
        "GET",
        "/v1/ledgers",
      );
      const cash = ledgers.find((l) => l.kind === "cash");
      assert.ok(cash);
      const statement = await ok<{ rowsTotal?: number }>(
        owner,
        "GET",
        `/v1/ledgers/${cash.id}/statement?limit=5`,
      );
      assert.equal(typeof statement.rowsTotal, "number");
      const whole = await ok<{ rowsTotal?: number }>(
        owner,
        "GET",
        `/v1/ledgers/${cash.id}/statement`,
      );
      assert.equal(whole.rowsTotal, undefined);

      // A save shows on the next read; cached rows never go stale.
      await party("customer", `Customer 99 ${tag}`);
      const after = await ok<Page<PartyRow>>(
        owner,
        "GET",
        "/v1/parties/page?type=customer&sort=name&limit=10",
      );
      assert.equal(after.total, 25);

      // Offline download: every page of a list in one batch.
      const batch = await ok<{
        results: { status: number; body: Page<unknown> }[];
      }>(owner, "POST", "/v1/reads/batch", {
        paths: [
          "/v1/parties/page?sort=name&type=customer",
          "/v1/parties/page?cursor=30&sort=name&type=customer",
          "/v1/vouchers/invoices/page?month=all&type=sale",
        ],
      });
      assert.deepEqual(
        batch.results.map((r) => r.status),
        [200, 200, 200],
      );
      assert.equal(batch.results[0].body.total, 25);

      // Documents: filters in the body, the page in the query.
      const docs = await ok<Page<unknown>>(
        owner,
        "POST",
        "/v1/documents/search/page?limit=10",
        {},
      );
      assert.equal(docs.total, 0);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
