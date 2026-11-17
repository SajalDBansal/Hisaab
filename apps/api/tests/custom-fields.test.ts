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
  "custom fields: settings define them, parties and sales carry checked values",
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
        BETTER_AUTH_SECRET: "custom-fields-fixture-only-secret-not-for-users",
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
        const email = `cf-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `CF ${suffix}`,
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
          name: `CF ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({ organizationId: firmId, userId: sales.id, role: "sales" });

      type Field = { id: string; key: string; version: number; kind: string };
      const area = await ok<Field>(
        owner,
        "POST",
        "/v1/settings/custom-fields",
        {
          entity: "party",
          name: "Area",
          kind: "choice",
          choices: ["North", "South"],
          print: true,
        },
      );
      assert.match(area.key, /^cf_[a-z0-9]{10}$/);
      const vehicle = await ok<Field>(
        owner,
        "POST",
        "/v1/settings/custom-fields",
        {
          entity: "voucher",
          name: "Vehicle no.",
          kind: "text",
          required: true,
          voucherTypes: ["sale"],
        },
      );

      // Sales staff read them (forms need them) but can't change them.
      const listed = await ok<Field[]>(
        sales,
        "GET",
        "/v1/settings/custom-fields",
      );
      assert.equal(listed.length, 2);
      const refused = await call(sales, "POST", "/v1/settings/custom-fields", {
        entity: "item",
        name: "Brand",
        kind: "text",
      });
      assert.equal(refused.statusCode, 403, refused.body);

      // A field's type never changes.
      const retype = await call(
        owner,
        "PUT",
        `/v1/settings/custom-fields/${area.id}`,
        { entity: "party", name: "Area", kind: "text" },
        { "if-match": String(area.version) },
      );
      assert.equal(retype.statusCode, 409, retype.body);

      const partyInput = (value: string) => ({
        name: `Customer ${tag}`,
        type: "customer",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
        customFields: { [area.key]: value },
      });
      const bad = await call(owner, "POST", "/v1/parties", partyInput("East"));
      assert.equal(bad.statusCode, 400, bad.body);
      const party = await ok<{
        id: string;
        customFields?: Record<string, string>;
      }>(owner, "POST", "/v1/parties", partyInput("South"));
      assert.deepEqual(party.customFields, { [area.key]: "South" });

      const supplier = await ok<{ id: string }>(owner, "POST", "/v1/parties", {
        ...partyInput("North"),
        name: `Supplier ${tag}`,
        type: "supplier",
        customFields: undefined,
      });
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
        lines: [{ itemId: item.id, qty: 5, rate: 10000, gstRate: 0 }],
        charges: [],
      });
      const sale = (customFields: Record<string, string>) =>
        call(owner, "POST", "/v1/sales/split", {
          partyId: party.id,
          date: today,
          lines: [{ itemId: item.id, qty: 1, rate: 15000, gstRate: 0 }],
          charges: [],
          customFields,
        });
      const missing = await sale({});
      assert.equal(missing.statusCode, 400, missing.body);
      assert.match(missing.body, /Vehicle no\. is required/);
      const saved = await sale({ [vehicle.key]: "DL01 AB 1234" });
      assert.ok(saved.statusCode < 300, saved.body);
      const [bill] = saved.json<{ id: string }[]>();
      const detail = await ok<{
        voucher: {
          customFields?: Record<string, string>;
          snapshot?: { party?: { customFields?: Record<string, string> } };
        };
      }>(owner, "GET", `/v1/vouchers/${bill.id}`);
      assert.deepEqual(detail.voucher.customFields, {
        [vehicle.key]: "DL01 AB 1234",
      });
      assert.deepEqual(detail.voucher.snapshot?.party?.customFields, {
        [area.key]: "South",
      });
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
