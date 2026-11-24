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
  "refunds: customer and supplier refunds within unused credit, debit-note credit applied to later bills, refunds report (T05)",
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
        BETTER_AUTH_SECRET: "refund-fixture-only-secret-not-for-users-123456",
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
      const email = `refund-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Refund",
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
          name: `Refund ${tag}`,
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
      type V = { id: string; number: string; type: string; amount: number };
      const [cash] = await ok<{ id: string }[]>("GET", "/v1/ledgers?kind=cash");
      const money = (
        partyId: string,
        amount: number,
        allocations: object[] = [],
      ) => ({
        partyId,
        date: today,
        amount,
        mode: "cash",
        ledgerId: cash.id,
        allocations,
        bookScope: "gst",
      });
      type Detail = {
        unallocated: number;
        unappliedCredit?: number;
        refundable?: { gst: number; nongst: number };
        openBills: { id: string; pending: number }[];
      };
      const detail = (id: string) => ok<Detail>("GET", `/v1/parties/${id}`);

      // Customer: an advance of 1,000 can be refunded up to what is unused.
      await ok("POST", "/v1/receipts", money(customer.id, 100000));
      assert.equal((await detail(customer.id)).refundable?.gst, 100000);
      const refund = await ok<V>(
        "POST",
        "/v1/payments",
        money(customer.id, 40000),
      );
      assert.equal(refund.type, "payment");
      const afterRefund = await detail(customer.id);
      assert.equal(afterRefund.unallocated, 60000);
      assert.equal(afterRefund.refundable?.gst, 60000);
      const tooMuch = await call(
        "POST",
        "/v1/payments",
        money(customer.id, 60001),
      );
      assert.ok(
        tooMuch.statusCode >= 400 && tooMuch.statusCode < 500,
        tooMuch.body,
      );
      assert.match(tooMuch.body, /unused credit/);

      // Supplier: bill paid in full, then goods returned; the debit-note credit
      // goes to the next bill through the allocate action.
      const bill = await ok<V>("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 2, rate: 10000, gstRate: 5 }],
        charges: [],
        supplierInvoiceNo: `S2-${tag}`,
      });
      await ok(
        "POST",
        "/v1/payments",
        money(supplier.id, bill.amount, [
          { voucherId: bill.id, amount: bill.amount },
        ]),
      );
      const note = await ok<V>("POST", "/v1/debit-notes", {
        againstId: bill.id,
        date: today,
        lines: [{ index: 0, qty: 1 }],
        reason: "Damaged",
      });
      assert.equal((await detail(supplier.id)).unappliedCredit, note.amount);
      const later = await ok<V>("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 3, rate: 10000, gstRate: 5 }],
        charges: [],
        supplierInvoiceNo: `S3-${tag}`,
      });
      const pendingOf = (d: Detail) =>
        d.openBills.reduce((n, b) => n + b.pending, 0);
      const pendingBefore = pendingOf(await detail(supplier.id));
      void later;
      const applied = await ok<{ allocated: number }>(
        "POST",
        `/v1/parties/${supplier.id}/allocate-payments`,
      );
      assert.equal(applied.allocated, note.amount);
      const supplierNow = await detail(supplier.id);
      assert.equal(supplierNow.unappliedCredit, 0);
      // Oldest open bill first (here the opening purchase).
      assert.equal(pendingOf(supplierNow), pendingBefore - note.amount);
      const savedNote = await ok<{
        allocations?: { voucherId: string; amount: number }[];
      }>("GET", `/v1/vouchers/${note.id}`);
      assert.equal(
        (savedNote.allocations ?? []).reduce((n, a) => n + a.amount, 0),
        note.amount,
      );

      // Supplier pays back an advance with a receipt; nothing more than that.
      const other = await ok<{ id: string }>("POST", "/v1/parties", {
        name: `Other supplier ${tag}`,
        type: "supplier",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      });
      await ok("POST", "/v1/payments", money(other.id, 5000));
      await ok("POST", "/v1/receipts", money(other.id, 5000));
      const extra = await call("POST", "/v1/receipts", money(other.id, 1));
      assert.ok(extra.statusCode >= 400 && extra.statusCode < 500, extra.body);

      // The refunds report lists both refunds.
      const report = await ok<{ sections: { rows: { cells: unknown[] }[] }[] }>(
        "POST",
        "/v1/reports/export",
        {
          report: "refunds",
          from: (await ok<{ fyStart: string }>("GET", "/v1/firms/current"))
            .fyStart,
          to: today,
          includeNarration: false,
          includeZeroBalances: false,
        },
      );
      const rows = report.sections[0].rows;
      assert.equal(rows.length, 3);
      const text = JSON.stringify(rows);
      assert.ok(text.includes("To customer") && text.includes("From supplier"));
      assert.equal(rows[2].cells.at(-1), 45000);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
