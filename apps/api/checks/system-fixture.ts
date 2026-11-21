import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createDb, schema } from "@repo/backend/db/client";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

// This harness is separate from server.ts and never loads the application's env file.
export const FIXTURE_DATABASE =
  "postgres://hardening:hardening-local-fixture-only@127.0.0.1:55442/hardening_system";
export const FIXTURE_ORIGIN = "http://localhost:3309";
export const FIXTURE_PASSWORD = "Fixture-Only-Password-2026!";
export const FIXTURE_AUTH_SECRET =
  "synthetic-system-fixture-auth-secret-never-use-in-production";
export const FIXTURE_ROLES = [
  "owner",
  "accountant",
  "sales",
  "viewer",
  "outsider",
  "invitee",
] as const;
export const fixtureEmail = (role: string) => `${role}@system-fixture.invalid`;

export async function startSystemFixture() {
  const { db, pool } = createDb(FIXTURE_DATABASE);
  const mail = memorySender();
  const app = await buildApp({
    db,
    email: mail.sender,
    storage: fakeStorage(),
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      BETTER_AUTH_SECRET: FIXTURE_AUTH_SECRET,
      BETTER_AUTH_URL: FIXTURE_ORIGIN,
      RECOVERY_EPOCH: DEVELOPMENT_RECOVERY_EPOCH,
      TRUSTED_ORIGINS: [
        FIXTURE_ORIGIN,
        "http://127.0.0.1:3309",
        "http://localhost:3900",
        "http://127.0.0.1:3900",
        "http://localhost:3902",
        "http://127.0.0.1:3902",
      ],
      SENTRY_TRACES_SAMPLE_RATE: 0,
    },
    readyChecks: [
      {
        name: "database",
        run: async () => {
          await pool.query("select 1");
        },
      },
    ],
  });
  const actors: Record<string, { id: string; cookie: string }> = {};
  const fixture = {
    api: FIXTURE_ORIGIN,
    password: FIXTURE_PASSWORD,
    recoveryEpoch: DEVELOPMENT_RECOVERY_EPOCH,
    accounts: FIXTURE_ROLES.map((role) => ({
      role,
      email: fixtureEmail(role),
    })),
    firmId: "",
    otherFirmId: "",
    invitationId: "",
  };
  // Only the loopback test harness exposes synthetic credentials and in-memory codes.
  app.get("/__fixture", async () => fixture);
  app.get<{ Querystring: { email?: string } }>(
    "/__fixture/otp",
    async (request) => ({
      code: request.query.email?.endsWith("@system-fixture.invalid")
        ? (mail.lastCode(request.query.email) ?? null)
        : null,
    }),
  );
  async function request(
    method: "GET" | "POST",
    url: string,
    payload?: object,
    cookie?: string,
    firmId?: string,
  ) {
    return app.inject({
      method,
      url,
      payload,
      headers: {
        origin: FIXTURE_ORIGIN,
        "x-platform": "app",
        [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
        ...(cookie ? { cookie } : {}),
        ...(firmId ? { "x-firm-id": firmId } : {}),
      },
    });
  }
  for (const [index, role] of FIXTURE_ROLES.entries()) {
    const email = fixtureEmail(role);
    const existing = await pool.query('select id from "user" where email=$1', [
      email,
    ]);
    let response;
    if (!existing.rowCount) {
      const signup = await request("POST", "/api/auth/sign-up/email", {
        name: `Fixture ${role}`,
        email,
        password: FIXTURE_PASSWORD,
        phoneNumber: `98000000${String(index + 10)}`,
      });
      assert.equal(signup.statusCode, 200, signup.body);
      response = await request("POST", "/api/auth/email-otp/verify-email", {
        email,
        otp: mail.lastCode(email),
      });
    } else {
      response = await app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: {
          origin: FIXTURE_ORIGIN,
          "x-platform": "app",
          "x-confirm-takeover": "true",
        },
        payload: { email, password: FIXTURE_PASSWORD },
      });
    }
    assert.equal(response.statusCode, 200, response.body);
    actors[role] = {
      id: response.json().user.id,
      cookie: response.cookies
        .map((entry) => `${entry.name}=${entry.value}`)
        .join("; "),
    };
  }
  async function firm(role: "owner" | "outsider", name: string) {
    const actor = actors[role];
    assert.ok(actor);
    const firms = await request("GET", "/v1/firms", undefined, actor.cookie);
    const existing = firms
      .json<{ id: string; name: string }[]>()
      .find((row) => row.name === name);
    if (existing) return existing.id;
    const response = await request(
      "POST",
      "/v1/firms",
      { name, city: "Delhi", stateCode: "07", gstRegistration: "unregistered" },
      actor.cookie,
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  fixture.firmId = await firm("owner", "System Fixture Trading");
  fixture.otherFirmId = await firm("outsider", "Separate Fixture Business");
  for (const role of ["accountant", "sales", "viewer"] as const) {
    const actor = actors[role];
    assert.ok(actor);
    await db
      .insert(schema.member)
      .values({ organizationId: fixture.firmId, userId: actor.id, role })
      .onConflictDoNothing();
  }
  const owner = actors.owner;
  assert.ok(owner);
  const invitations = await request(
    "GET",
    "/v1/firms/current/invitations",
    undefined,
    owner.cookie,
    fixture.firmId,
  );
  let invite = invitations
    .json<{ id: string; email: string }[]>()
    .find((row) => row.email === fixtureEmail("invitee"));
  const invitee = actors.invitee;
  assert.ok(invitee);
  const membership = await pool.query("select 1 from member where user_id=$1", [
    invitee.id,
  ]);
  if (!invite && !membership.rowCount) {
    const created = await request(
      "POST",
      "/v1/firms/current/invitations",
      { email: fixtureEmail("invitee"), role: "sales" },
      owner.cookie,
      fixture.firmId,
    );
    assert.equal(created.statusCode, 201, created.body);
    invite = created.json();
  }
  fixture.invitationId = invite?.id ?? "";
  const parties = await request(
    "GET",
    "/v1/parties",
    undefined,
    owner.cookie,
    fixture.firmId,
  );
  if (!parties.json().items.length) {
    for (const type of ["customer", "supplier"] as const) {
      const created = await request(
        "POST",
        "/v1/parties",
        {
          name: type === "customer" ? "Fixture Customer" : "Fixture Supplier",
          type,
          phone: "",
          city: "Delhi",
          stateCode: "07",
          creditDays: 7,
          creditLimit: 0,
          openingBalance: 0,
        },
        owner.cookie,
        fixture.firmId,
      );
      assert.equal(created.statusCode, 201, created.body);
    }
    const item = await request(
      "POST",
      "/v1/items",
      {
        name: "Fixture Hardware",
        code: "FIX-01",
        hsn: "",
        group: "Hardware",
        taxType: "nongst",
        gstRate: 0,
        unit: "Pcs",
        purchasePrice: 10000,
        salePrice: 15000,
        mrp: 0,
        reorderLevel: 2,
        openingStock: 20,
        openingCost: 10000,
        openingBookScope: "nongst",
      },
      owner.cookie,
      fixture.firmId,
    );
    assert.equal(item.statusCode, 201, item.body);
  }
  // Browser accounts start without an active device so their first sign-in is ordinary.
  for (const actor of Object.values(actors))
    await request("POST", "/api/auth/sign-out", {}, actor.cookie);
  await app.listen({ host: "127.0.0.1", port: 3309 });
  process.stdout.write(
    `${JSON.stringify({ ready: true, ...fixture }, null, 2)}\n`,
  );
  const close = async () => {
    await app.close();
    await pool.end();
  };
  process.once("SIGTERM", () => {
    void close().then(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void close().then(() => process.exit(0));
  });
  return { app, pool, close, fixture };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await startSystemFixture();
