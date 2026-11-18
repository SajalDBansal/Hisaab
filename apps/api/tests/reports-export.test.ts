import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { REPORT_IDS } from "@repo/core";
import { createDb } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// Only the explicitly supplied disposable database; never .env.
test(
  "every report, including the Phase 1 ones, exports through the API",
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
        BETTER_AUTH_SECRET: "reports-export-fixture-only-secret-not-for-users",
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
      const email = `reports-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Reports",
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
          name: `Reports ${tag}`,
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
      await ok("POST", "/v1/sales/split", {
        partyId: customer.id,
        date: today,
        lines: [{ itemId: item.id, qty: 2, rate: 15000, gstRate: 5 }],
        charges: [],
      });
      const current = await ok<{ fyStart: string }>("GET", "/v1/firms/current");

      type Doc = {
        title: string;
        sections: { title: string; rows: unknown[] }[];
      };
      const docs = new Map<string, Doc>();
      for (const report of REPORT_IDS) {
        const doc = await ok<Doc>("POST", "/v1/reports/export", {
          report,
          from: current.fyStart,
          to: today,
          includeNarration: false,
          includeZeroBalances: false,
          ...(report === "interest-calculator" ? { interestRate: 15 } : {}),
        });
        // A report with nothing in the period (the cash book here) has no sections.
        assert.ok(doc.title, report);
        assert.ok(Array.isArray(doc.sections), report);
        docs.set(report, doc);
      }
      const text = (report: string) =>
        JSON.stringify(docs.get(report)?.sections ?? []);
      // The Phase 1 reports see the purchase and the sale made above.
      for (const report of ["sales-by-item", "purchases-by-item"])
        assert.ok(text(report).includes(`Item ${tag}`), report);
      for (const report of [
        "sales-by-party",
        "top-customers",
        "customer-tracking",
      ])
        assert.ok(text(report).includes(`customer ${tag}`), report);
      for (const report of ["purchases-by-party", "top-suppliers"])
        assert.ok(text(report).includes(`supplier ${tag}`), report);
      assert.ok(text("gstr2").includes("09BBBBB1111B1ZL"), "gstr2");
      // A bill dated today is neither near the 180-day ITC limit nor overdue.
      assert.ok(
        !text("itc-at-risk").includes(`supplier ${tag}`),
        "itc-at-risk",
      );
      assert.ok(
        !text("interest-calculator").includes(`customer ${tag}`),
        "interest",
      );

      // The owner sees where changes came from (entries: audit-origin.test.ts).
      assert.ok(text("audit-trail").includes("IP address"), "audit-trail");

      // GSTR-1 upload file (T31): the small sale to an unregistered buyer is B2C Small.
      type Gstr1File = {
        fileName: string;
        warnings: string[];
        json: {
          gstin: string;
          fp: string;
          b2b?: unknown[];
          b2cs?: {
            sply_ty: string;
            pos: string;
            rt: number;
            txval: number;
            camt?: number;
            samt?: number;
          }[];
          hsn?: {
            hsn_b2c: {
              hsn_sc: string;
              uqc: string;
              qty: number;
              txval: number;
            }[];
          };
          doc_issue?: {
            doc_det: { doc_num: number; docs: { totnum: number }[] }[];
          };
        };
      };
      const month = today.slice(0, 7);
      const file = await ok<Gstr1File>(
        "GET",
        `/v1/gst/gstr1/download?month=${month}`,
      );
      assert.equal(file.json.gstin, "07AAAAA0000A1Z4");
      assert.equal(file.json.fp, `${month.slice(5)}${month.slice(0, 4)}`);
      assert.equal(file.json.b2b, undefined);
      assert.deepEqual(file.json.b2cs, [
        {
          sply_ty: "INTRA",
          pos: "07",
          typ: "OE",
          rt: 5,
          txval: 300,
          camt: 7.5,
          samt: 7.5,
          csamt: 0,
        },
      ]);
      assert.deepEqual(
        file.json.hsn?.hsn_b2c.map((r) => [r.hsn_sc, r.uqc, r.qty, r.txval]),
        [["1006", "PCS", 2, 300]],
      );
      assert.equal(file.json.doc_issue?.doc_det[0].docs[0].totnum, 1);
      assert.deepEqual(file.warnings, []);
      const badMonth = await call("GET", "/v1/gst/gstr1/download?month=2026-1");
      assert.equal(badMonth.statusCode, 400, badMonth.body);

      // A rate on any other report is refused.
      const refused = await call("POST", "/v1/reports/export", {
        report: "sales-register",
        from: current.fyStart,
        to: today,
        includeNarration: false,
        includeZeroBalances: false,
        interestRate: 15,
      });
      assert.equal(refused.statusCode, 422, refused.body);
      assert.match(refused.body, /Only the interest calculator/);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
