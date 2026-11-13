import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import {
  createReplica,
  memoryReplicaStore,
  partyService,
  replicaVoucher,
  reportService,
  setReplicaBooks,
} from "@repo/core";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "the books on the phone stay identical to the server's, change after change",
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
        BETTER_AUTH_SECRET: "replica-fixture-only-secret-not-used-by-accounts",
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
        const email = `replica-${tag}-${suffix}@example.invalid`;
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
        method: "GET" | "POST" | "PUT" | "DELETE",
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
        method: "GET" | "POST" | "PUT" | "DELETE",
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
          name: `Replica ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: sales.id, role: "sales" });
      const party = (type: "customer" | "supplier", name: string) =>
        ok<{ id: string; version: number }>(owner, "POST", "/v1/parties", {
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
      const customers: { id: string; version: number }[] = [];
      for (let i = 0; i < 6; i++)
        customers.push(await party("customer", `Customer ${i} ${tag}`));
      const itemInput = (name: string) => ({
        name,
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
      const item = await ok<{ id: string }>(
        owner,
        "POST",
        "/v1/items",
        itemInput(`Item ${tag}`),
      );
      const spare = await ok<{ id: string; version: number }>(
        owner,
        "POST",
        "/v1/items",
        itemInput(`Spare ${tag}`),
      );
      const today = new Date().toISOString().slice(0, 10);
      await ok(owner, "POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 100, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const sell = (i: number) =>
        ok<{ id: string; version: number }[]>(
          owner,
          "POST",
          "/v1/sales/split",
          {
            partyId: customers[i % customers.length].id,
            date: today,
            lines: [{ itemId: item.id, qty: 1 + i, rate: 15000, gstRate: 0 }],
            charges: [],
          },
        );
      for (let i = 0; i < 5; i++) await sell(i);

      // The phone: the real sync engine, its store in memory, reading the API
      // as the owner would.
      const get = async (path: string) => {
        const reply = await call(owner, "GET", path);
        assert.equal(reply.statusCode, 200, `${path}: ${reply.body}`);
        return reply.json();
      };
      const store = memoryReplicaStore();
      const phone = createReplica({ firmId, store, get });
      assert.equal(await phone.open(), false);
      await phone.sync();
      assert.equal(phone.state().phase, "ready");

      /** The phone's books equal the server's own books, row for row. */
      async function sameAsServer(when: string) {
        // As it travels: JSON leaves out keys whose value is undefined.
        const server = JSON.parse(
          JSON.stringify(await loadReportBooks(db, firmId)),
        ) as Awaited<ReturnType<typeof loadReportBooks>>;
        const local = phone.books();
        assert.ok(local, when);
        const byId = <T extends { id: string }>(rows: T[]) =>
          [...rows].sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(
          byId(local.parties),
          byId(server.parties),
          `${when}: parties`,
        );
        assert.deepEqual(
          byId(local.items),
          byId(server.items),
          `${when}: items`,
        );
        assert.deepEqual(
          local.vouchers,
          server.vouchers.map(replicaVoucher),
          `${when}: vouchers, in the server's order`,
        );
        assert.deepEqual(local.ledgers, server.ledgers, `${when}: ledgers`);
        assert.deepEqual(local.firm, server.firm, `${when}: firm`);
        const head = await get("/v1/replica/head");
        assert.equal(phone.seq(), head.seq, `${when}: cursor`);
        assert.deepEqual(phone.checksum(), head.checksum, `${when}: checksum`);
      }
      await sameAsServer("first download");

      // Saves on the server reach the phone through changes only.
      await sell(5);
      const receipt = await ok<{ id: string }>(owner, "POST", "/v1/receipts", {
        partyId: customers[0].id,
        date: today,
        amount: 5000,
        ledgerId: (
          await ok<{ id: string; kind: string }[]>(owner, "GET", "/v1/ledgers")
        ).find((l) => l.kind === "cash")?.id,
        mode: "cash",
        allocations: [],
      });
      assert.ok(receipt.id);
      await ok(
        owner,
        "PUT",
        `/v1/parties/${customers[1].id}`,
        {
          name: `Renamed ${tag}`,
          type: "customer",
          phone: "",
          city: "Agra",
          stateCode: "07",
          gstin: "",
          creditDays: 15,
          creditLimit: 0,
          openingBalance: 0,
        },
        { "if-match": `"${customers[1].version}"` },
      );
      const removed = await call(
        owner,
        "DELETE",
        `/v1/items/${spare.id}`,
        undefined,
        {
          "if-match": `"${spare.version}"`,
        },
      );
      assert.ok(removed.statusCode < 300, removed.body);
      const [toCancel] = await sell(6);
      const cancelled = await call(
        owner,
        "POST",
        `/v1/vouchers/${toCancel.id}/cancel`,
        { reason: "Entered twice" },
        { "if-match": `"${toCancel.version}"` },
      );
      assert.ok(cancelled.statusCode < 300, cancelled.body);
      await phone.sync();
      await sameAsServer(
        "after a sale, receipt, rename, removal and cancellation",
      );
      assert.ok(!phone.books()?.items.some((i) => i.id === spare.id));

      // Restart: the phone reopens its copy without downloading again.
      const reopened = createReplica({ firmId, store, get });
      assert.equal(await reopened.open(), true);
      assert.deepEqual(reopened.checksum(), phone.checksum());

      // A damaged copy is found by the checksum and downloaded again.
      const damaged = createReplica({ firmId, store, get });
      await damaged.open();
      const saved = await store.read(firmId);
      const voucherRow = saved.rows.find((r) => r.kind === "vouchers");
      assert.ok(voucherRow && saved.meta);
      await store.write(firmId, {
        meta: saved.meta,
        upserts: [
          {
            kind: "vouchers",
            id: JSON.parse(voucherRow.json).id,
            json: JSON.stringify({ ...JSON.parse(voucherRow.json), amount: 1 }),
          },
        ],
        removes: [],
      });
      await damaged.open();
      await damaged.verify();
      const head = await get("/v1/replica/head");
      assert.deepEqual(damaged.checksum(), head.checksum);

      // Offline, the core engine on the phone's copy gives the server's numbers.
      setReplicaBooks(phone.books());
      const localDashboard = await reportService.dashboard("all");
      const serverDashboard = await ok<{ toCollect: number; toPay: number }>(
        owner,
        "GET",
        "/v1/reports/dashboard?tax=all",
      );
      assert.equal(localDashboard.toCollect, serverDashboard.toCollect);
      assert.equal(localDashboard.toPay, serverDashboard.toPay);
      const localParty = await partyService.get(customers[0].id);
      const serverParty = await ok<{ balance: number }>(
        owner,
        "GET",
        `/v1/parties/${customers[0].id}`,
      );
      assert.equal(localParty.balance, serverParty.balance);
      setReplicaBooks(null);

      // Sales staff may not hold the whole books.
      const refused = await call(sales, "GET", "/v1/replica/head");
      assert.equal(refused.statusCode, 403);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
