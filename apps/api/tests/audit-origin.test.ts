import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { deviceLabel } from "@repo/backend/lib/request-origin";
import { today } from "@repo/core";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

test("device labels name the device and the kind of client", () => {
  assert.equal(
    deviceLabel({ deviceName: "Pixel 8", platform: "app" }),
    "Pixel 8 (App)",
  );
  assert.equal(
    deviceLabel({ deviceName: " ", platform: "web" }),
    "Web browser",
  );
  assert.equal(deviceLabel({}), "Phone app");
});

// Only the explicitly supplied disposable database; never .env.
test(
  "the edit log keeps each change's IP address and device, shown only to the owner",
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
        BETTER_AUTH_SECRET: "audit-origin-fixture-only-secret-not-for-users",
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
    const IP = "203.0.113.7";
    try {
      async function account(suffix: string, client: Record<string, string>) {
        const email = `audit-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Audit ${suffix}`,
            email,
            password: "Fixture-password-123!",
            phoneNumber: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
          },
        });
        assert.equal(signup.statusCode, 200, signup.body);
        // The session made here carries the device name and platform.
        const verify = await app.inject({
          method: "POST",
          url: "/api/auth/email-otp/verify-email",
          headers: { ...headers, ...client },
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
      const owner = await account("owner", {
        "x-device-name": "Owner Phone",
        "x-platform": "app",
      });
      const accountant = await account("accountant", { "x-platform": "web" });
      let firmId = "";
      const call = async <T>(
        who: { cookie: string },
        method: "GET" | "POST",
        path: string,
        payload?: object,
      ) => {
        const reply = await app.inject({
          method,
          url: path,
          remoteAddress: IP,
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
        assert.ok(
          reply.statusCode < 300,
          `${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.json<T>();
      };

      firmId = (
        await call<{ id: string }>(owner, "POST", "/v1/firms", {
          name: `Audit ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db.insert(schema.member).values({
        organizationId: firmId,
        userId: accountant.id,
        role: "accountant",
      });
      const customer = await call<{ id: string }>(
        owner,
        "POST",
        "/v1/parties",
        {
          name: `Customer ${tag}`,
          type: "customer",
          phone: "",
          city: "Delhi",
          stateCode: "07",
          gstin: "",
          creditDays: 0,
          creditLimit: 0,
          openingBalance: 0,
        },
      );
      const cash = (
        await call<{ id: string; kind: string }[]>(owner, "GET", "/v1/ledgers")
      ).find((l) => l.kind === "cash");
      assert.ok(cash);
      const receipt = await call<{ id: string }>(
        owner,
        "POST",
        "/v1/receipts",
        {
          partyId: customer.id,
          date: today(),
          amount: 5000,
          ledgerId: cash.id,
          mode: "cash",
          allocations: [],
        },
      );

      // Stored with the change.
      const [row] = await db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.voucherId, receipt.id));
      assert.ok(row);
      assert.equal(row.ipAddress, IP);
      assert.equal(row.device, "Owner Phone (App)");

      type Page = {
        items: { voucherId: string; ipAddress?: string; device?: string }[];
      };
      const entryFor = (page: Page) =>
        page.items.find((item) => item.voucherId === receipt.id);

      // The owner sees where it came from.
      const ownerView = entryFor(
        await call<Page>(owner, "GET", "/v1/audit-log/page?limit=50"),
      );
      assert.equal(ownerView?.ipAddress, IP);
      assert.equal(ownerView?.device, "Owner Phone (App)");

      // An accountant reads the same log without them.
      for (const path of [
        "/v1/audit-log/page?limit=50",
        "/v1/audit-log?limit=50",
      ]) {
        const seen = entryFor(await call<Page>(accountant, "GET", path));
        assert.ok(seen, path);
        assert.equal(seen.ipAddress, undefined, path);
        assert.equal(seen.device, undefined, path);
      }

      // The audit trail report (T55): IP and device columns for the owner only.
      type Doc = {
        sections: {
          columns: { label: string }[];
          rows: { cells: unknown[] }[];
        }[];
      };
      const exportAs = (who: { cookie: string }) =>
        call<Doc>(who, "POST", "/v1/reports/export", {
          report: "audit-trail",
          from: today(),
          to: today(),
          includeNarration: false,
          includeZeroBalances: false,
        });
      const ownerDoc = await exportAs(owner);
      assert.deepEqual(
        ownerDoc.sections[0].columns.slice(-2).map((c) => c.label),
        ["IP address", "Device"],
      );
      assert.ok(
        ownerDoc.sections[0].rows.some(
          (r) => r.cells.includes(IP) && r.cells.includes("Owner Phone (App)"),
        ),
      );
      const accountantDoc = await exportAs(accountant);
      assert.equal(
        accountantDoc.sections[0].rows.length,
        ownerDoc.sections[0].rows.length,
      );
      assert.ok(!JSON.stringify(accountantDoc).includes(IP));
      assert.ok(!JSON.stringify(accountantDoc).includes("Owner Phone"));
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
