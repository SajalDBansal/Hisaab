/** Shared setup for the catalogue tests (doc 37, T10/T35/T36): an owner and a firm. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { createDb } from "@repo/backend/db/client";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Who = { id: string; cookie: string };

// Only the explicitly supplied disposable database; never .env.
export async function catalogFixture(name: string) {
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
      BETTER_AUTH_SECRET: `${name}-fixture-only-secret-not-for-users`,
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
  async function account(suffix: string): Promise<Who> {
    const email = `${name}-${tag}-${suffix}@example.invalid`;
    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers,
      payload: {
        name: `${name} ${suffix}`,
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
  let firmId = "";
  const call = (
    who: Who,
    method: Method,
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
    who: Who,
    method: Method,
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
  const owner = await account("owner");
  firmId = (
    await ok<{ id: string }>(owner, "POST", "/v1/firms", {
      name: `${name} ${tag}`,
      city: "Delhi",
      stateCode: "07",
      gstRegistration: "unregistered",
    })
  ).id;
  const party = (type: "customer" | "supplier", extra: object = {}) =>
    ok<{ id: string; version: number }>(owner, "POST", "/v1/parties", {
      name: `${type} ${randomUUID().slice(0, 6)}`,
      type,
      phone: "",
      city: "Delhi",
      stateCode: "07",
      gstin: "",
      creditDays: 0,
      creditLimit: 0,
      openingBalance: 0,
      ...extra,
    });
  const item = (extra: object = {}) =>
    ok<{ id: string; version: number; code: string; name: string }>(
      owner,
      "POST",
      "/v1/items",
      {
        name: `Item ${randomUUID().slice(0, 6)}`,
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
        ...extra,
      },
    );
  /** The firm export's data, as the owner downloads it. */
  const exported = async <T>() =>
    (
      JSON.parse(
        (await ok<{ text: string }>(owner, "GET", "/v1/backup/export")).text,
      ) as { payload: { data: T } }
    ).payload.data;
  const today = new Date().toISOString().slice(0, 10);
  return {
    app,
    db,
    tag,
    owner,
    account,
    firmId: () => firmId,
    call,
    ok,
    party,
    item,
    exported,
    today,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
