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
  "discounts and charges: subtotal discount, charge heads, returns, GSTR-1, print and export (T09)",
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
        BETTER_AUTH_SECRET: "discounts-fixture-only-secret-not-for-users-x",
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
      const email = `disc-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Disc",
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
        method: "GET" | "POST" | "PATCH",
        path: string,
        payload?: object,
      ) =>
        app.inject({
          method,
          url: path,
          headers: {
            ...headers,
            cookie,
            ...(firmId ? { "x-firm-id": firmId } : {}),
            ...(method !== "GET"
              ? { "idempotency-key": newRequestId(randomUUID()) }
              : {}),
          },
          payload,
        });
      const ok = async <T>(
        method: "GET" | "POST" | "PATCH",
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
          name: `Disc ${tag}`,
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
      const supplier = await party("supplier", "07BBBBB1111B1ZP");
      const customer = await party("customer", "07CCCCC2222C1ZA");
      const item = await ok<{ id: string }>("POST", "/v1/items", {
        name: `Item ${tag}`,
        code: "",
        hsn: "1006",
        group: "",
        taxType: "taxable",
        gstRate: 18,
        unit: "Pcs",
        purchasePrice: 10000,
        salePrice: 20000,
        mrp: 0,
        reorderLevel: 0,
        openingStock: 0,
      });
      const today = new Date().toISOString().slice(0, 10);

      // Charge heads live in invoice settings; the list is checked.
      const bad = await call("PATCH", "/v1/settings/invoice", {
        chargeHeads: [
          {
            id: "p",
            name: "Packing",
            taxType: "taxable",
            gstRate: 0,
            active: true,
          },
        ],
      });
      assert.equal(bad.statusCode, 400, bad.body);
      const settings = await ok<{ chargeHeads: unknown[] }>(
        "PATCH",
        "/v1/settings/invoice",
        {
          chargeHeads: [
            {
              id: "packing",
              name: "Packing",
              taxType: "taxable",
              gstRate: 18,
              sac: "998540",
              active: true,
            },
            {
              id: "loading",
              name: "Loading",
              taxType: "exempt",
              gstRate: 0,
              salesLedger: "Loading Recovered",
              active: true,
            },
          ],
        },
      );
      assert.equal(settings.chargeHeads.length, 2);
      const read = await ok<{ chargeHeads: unknown[] }>(
        "GET",
        "/v1/settings/invoice",
      );
      assert.equal(read.chargeHeads.length, 2);

      const purchase = await ok<{ id: string }>("POST", "/v1/purchases", {
        partyId: supplier.id,
        date: today,
        lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 18 }],
        charges: [],
        billDiscount: { percent: 10 },
      });
      const bought = await ok<{ lines: { stockCost?: number }[] }>(
        "GET",
        `/v1/vouchers/${purchase.id}`,
      );
      assert.equal(bought.lines[0].stockCost, 90000);
      const [sale] = await ok<{ id: string; amount: number }[]>(
        "POST",
        "/v1/sales/split",
        {
          partyId: customer.id,
          date: today,
          lines: [
            // A client-sent share and frozen charge details are ignored.
            {
              itemId: item.id,
              qty: 3,
              rate: 20000,
              gstRate: 18,
              billDiscountShare: 99,
            },
          ],
          charges: [
            {
              name: "Packing",
              amount: 5000,
              gstRate: 0,
              headId: "packing",
              account: "capital",
            },
            { name: "Loading", amount: 1000, gstRate: 18, headId: "loading" },
            { name: "Freight", amount: 2000, gstRate: 18 },
          ],
          billDiscount: { amount: 6000 },
        },
      );
      type Detail = {
        amount: number;
        version: number;
        billDiscount?: { amount: number; percent?: number };
        lines: { billDiscountShare?: number }[];
        charges: {
          name: string;
          gstRate: number;
          taxType?: string;
          account?: string;
        }[];
        totals: {
          billDiscount: number;
          itemsTaxable: number;
          grandTotal: number;
        };
        postings: { account: string; debit: number; credit: number }[];
        postingTotals: { balanced: boolean };
        snapshot: { settings: Record<string, unknown> };
      };
      const detail = await ok<Detail>("GET", `/v1/vouchers/${sale.id}`);
      assert.deepEqual(detail.billDiscount, { amount: 6000 });
      assert.equal(detail.lines[0].billDiscountShare, 6000);
      assert.equal(detail.totals.billDiscount, 6000);
      assert.equal(detail.totals.itemsTaxable, 54000);
      // 54000 + 9720 GST, packing 5000 + 900, loading 1000 exempt, freight 2000 + 360
      assert.equal(detail.amount, 73000); // 72980 rounded to the rupee
      assert.equal(detail.totals.grandTotal, detail.amount);
      assert.deepEqual(
        detail.charges.map((c) => [c.name, c.gstRate, c.taxType, c.account]),
        [
          ["Packing", 18, "taxable", "income:Packing Charged"],
          ["Loading", 0, "exempt", "income:Loading Recovered"],
          ["Freight", 18, undefined, undefined],
        ],
      );
      assert.ok(detail.postingTotals.balanced);
      const posted = (account: string) =>
        detail.postings.find((p) => p.account === account)?.credit;
      assert.equal(posted("sales"), 54000);
      assert.equal(posted("income:Packing Charged"), 5000);
      assert.equal(posted("income:Loading Recovered"), 1000);
      assert.equal(posted("income:Freight Charged"), 2000);
      assert.equal("chargeHeads" in detail.snapshot.settings, false);

      // GSTR-1 uses the discounted value; the exempt charge is in table 8.
      const gstr1 = await ok<{
        b2b: { taxable: number }[];
        noTax: { exempt: number }[];
      }>("GET", `/v1/gst/gstr1?month=${today.slice(0, 7)}`);
      assert.equal(gstr1.b2b[0].taxable, 54000 + 5000 + 2000);
      assert.equal(
        gstr1.noTax.reduce((s, r) => s + r.exempt, 0),
        1000,
      );

      // Print shows the discount and each charge.
      const print = await ok<{ html: string }>(
        "GET",
        `/v1/vouchers/${sale.id}/print`,
      );
      for (const text of [
        "Sub total",
        "Discount",
        "Packing",
        "Loading",
        "Exempt",
      ])
        assert.ok(print.html.includes(text), text);

      // Edit before any return: a percentage replaces the amount.
      const edit = await app.inject({
        method: "PUT",
        url: `/v1/vouchers/${sale.id}`,
        headers: {
          ...headers,
          cookie,
          "x-firm-id": firmId,
          "if-match": String(detail.version),
        },
        payload: {
          partyId: customer.id,
          date: today,
          lines: [{ itemId: item.id, qty: 3, rate: 20000, gstRate: 18 }],
          charges: [],
          billDiscount: { percent: 5 },
        },
      });
      assert.equal(edit.statusCode, 200, edit.body);
      const edited = await ok<Detail>("GET", `/v1/vouchers/${sale.id}`);
      assert.deepEqual(edited.billDiscount, { percent: 5, amount: 3000 });
      // 57000 + 10260 GST
      assert.equal(edited.amount, 67300); // 67260 rounded

      // Returning everything in two notes gives back exactly the bill.
      const note = (qty: number) =>
        ok<{ id: string; amount: number }>("POST", "/v1/credit-notes", {
          againstId: sale.id,
          date: today,
          lines: [{ index: 0, qty }],
          reason: "Damaged",
        });
      const first = await note(1);
      const second = await note(2);
      assert.equal(first.amount + second.amount, edited.amount);
      const noteDetail = await ok<Detail>("GET", `/v1/vouchers/${first.id}`);
      assert.ok(noteDetail.postingTotals.balanced);

      // The firm export carries the new columns (it refuses unknown columns).
      const exported = await call("GET", "/v1/backup/export");
      assert.equal(exported.statusCode, 200, exported.body.slice(0, 300));
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
