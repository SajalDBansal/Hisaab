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
  "business profile and MSME payables: statutory fields, MSME suppliers, 45-day report (T61, T30)",
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
        BETTER_AUTH_SECRET:
          "business-profile-fixture-only-secret-not-for-users",
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
      const email = `profile-${tag}@example.invalid`;
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: "Profile",
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
        method: "GET" | "POST" | "PATCH" | "PUT",
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
        method: "GET" | "POST" | "PATCH" | "PUT",
        path: string,
        payload?: object,
        extra: Record<string, string> = {},
      ) => {
        const reply = await call(method, path, payload, extra);
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
          name: `Profile ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstin: "07AAAAA0000A1Z4",
          gstRegistration: "regular",
        },
      );
      firmId = firm.id;
      const today = new Date().toISOString().slice(0, 10);
      const back = new Date(Date.now() - 60 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      // ---- Firm statutory details (T61) ----
      const bad = await call("PATCH", "/v1/firms/current", { tan: "NOPE" });
      assert.equal(bad.statusCode, 400, bad.body);
      const lone = await call("PATCH", "/v1/firms/current", {
        udyamNumber: "UDYAM-DL-01-0000001",
      });
      assert.equal(lone.statusCode, 400, lone.body); // needs micro/small/medium
      const saved = await ok<Record<string, unknown>>(
        "PATCH",
        "/v1/firms/current",
        {
          ownershipType: "partnership",
          businessType: "wholesale",
          industry: "Pharmacy",
          tan: "dela12345b",
          udyamNumber: "UDYAM-DL-01-0000001",
          msmeType: "micro",
          fssai: "12345678901234",
          drugLicence: "20B/DL/123",
          website: "www.example.com",
        },
      );
      assert.equal(saved.tan, "DELA12345B");
      assert.equal(saved.msmeType, "micro");
      await ok("PATCH", "/v1/firms/current", { website: "" });
      const current = await ok<Record<string, unknown> & { fyStart: string }>(
        "GET",
        "/v1/firms/current",
      );
      assert.equal(current.website, undefined);
      assert.equal(current.fssai, "12345678901234");
      assert.equal(current.ownershipType, "partnership");

      // ---- MSME suppliers (T30) ----
      type PartyRow = {
        id: string;
        version: number;
        msmeType?: string;
        udyamNumber?: string;
      };
      const supplierBody = {
        name: `Micro ${tag}`,
        type: "supplier",
        phone: "",
        city: "Delhi",
        stateCode: "09",
        gstin: "09BBBBB1111B1ZL",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      };
      const badUdyam = await call("POST", "/v1/parties", {
        ...supplierBody,
        msmeType: "micro",
        udyamNumber: "UDYAM-1",
      });
      assert.equal(badUdyam.statusCode, 400, badUdyam.body);
      const micro = await ok<PartyRow>("POST", "/v1/parties", {
        ...supplierBody,
        msmeType: "micro",
        udyamNumber: "udyam-up-09-0012345",
      });
      assert.equal(micro.msmeType, "micro");
      assert.equal(micro.udyamNumber, "UDYAM-UP-09-0012345");
      // An older app that sends no MSME fields keeps them.
      const kept = await ok<PartyRow>(
        "PUT",
        `/v1/parties/${micro.id}`,
        { ...supplierBody, city: "Noida" },
        { "if-match": String(micro.version) },
      );
      assert.equal(kept.msmeType, "micro");
      const plain = await ok<PartyRow>("POST", "/v1/parties", {
        ...supplierBody,
        name: `Plain ${tag}`,
        gstin: "09CCCCC2222C1Z6",
      });
      assert.equal(plain.msmeType, undefined);

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
      // 60 days back, no credit days: pay by 15 days after the bill.
      if (back < current.fyStart) return;
      for (const partyId of [micro.id, plain.id])
        await ok("POST", "/v1/purchases", {
          partyId,
          date: back,
          lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 5 }],
          charges: [],
        });
      type Doc = {
        title: string;
        notes: string[];
        sections: {
          title: string;
          rows: { cells: unknown[]; total?: boolean }[];
        }[];
      };
      const report = await ok<Doc>("POST", "/v1/reports/export", {
        report: "msme-payables",
        from: current.fyStart,
        to: today,
        includeNarration: false,
        includeZeroBalances: false,
        interestRate: 18,
      });
      const rows = report.sections[0].rows.filter((r) => !r.total);
      assert.equal(rows.length, 1, JSON.stringify(report.sections[0]));
      const [status, , , name, msme, , , days, unpaid, interest] =
        rows[0].cells;
      assert.equal(status, "Overdue");
      assert.equal(name, `Micro ${tag}`);
      assert.equal(msme, "Micro");
      assert.equal(days, 45);
      assert.equal(unpaid, 105_000);
      assert.ok(Number(interest) > 0);
      assert.ok(report.notes.some((n) => n.includes("43B(h)")));
      const refused = await call("POST", "/v1/reports/export", {
        report: "payables",
        from: current.fyStart,
        to: today,
        includeNarration: false,
        includeZeroBalances: false,
        interestRate: 18,
      });
      assert.equal(refused.statusCode, 422, refused.body);

      // ---- The firm export carries both (version 5, optional fields) ----
      const exported = await ok<{ text: string }>("GET", "/v1/backup/export");
      const data = JSON.parse(exported.text).payload.data;
      assert.equal(data.firmProfile.fssai, "12345678901234");
      assert.equal(data.firmProfile.website, null);
      const row = data.parties.find((p: { id: string }) => p.id === micro.id);
      assert.equal(row.msmeType, "micro");
      assert.equal(row.udyamNumber, "UDYAM-UP-09-0012345");
      const inspected = await call("POST", "/v1/backup/inspect", {
        text: exported.text,
      });
      assert.equal(inspected.statusCode, 200, inspected.body);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
