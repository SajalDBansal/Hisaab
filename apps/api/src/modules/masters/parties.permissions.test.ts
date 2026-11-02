import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type {
  PartyInput,
  PartyRow,
  Role,
  SyncPushMutation,
} from "@repo/contracts";
import {
  newRequestId,
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { createDb, schema } from "@repo/backend/db/client";
import { buildApp } from "../../app";
import { memorySender } from "../../lib/email";

const databaseUrl = process.env.SECURITY_TEST_DATABASE_URL;

// This opt-in integration test only accepts the separately provisioned disposable database.
test(
  "party writes enforce the current role across HTTP, operations and sync",
  {
    skip: !databaseUrl,
  },
  async (t) => {
    assert.ok(databaseUrl);
    assert.equal(new URL(databaseUrl).pathname, "/hardening_security");
    assert.ok(
      ["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname),
    );
    const { db, pool } = createDb(databaseUrl);
    const mail = memorySender();
    const app = await buildApp({
      db,
      email: mail.sender,
      env: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        BETTER_AUTH_SECRET:
          "security-fixture-secret-which-is-never-used-outside-tests",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:3000"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
      },
    });
    t.after(async () => {
      await app.close();
      await pool.end();
    });
    const actors = {} as Record<
      Role | "outsider",
      { id: string; cookie: string; email: string }
    >;
    let index = 0;
    for (const role of [
      "owner",
      "accountant",
      "sales",
      "viewer",
      "outsider",
    ] as const) {
      const email = `security-${role}-${randomUUID()}@example.invalid`;
      const headers = { origin: "http://localhost:3000", "x-platform": "web" };
      const signup = await app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers,
        payload: {
          name: `Fixture ${role}`,
          email,
          password: "Only-a-disposable-test-123!",
          phoneNumber: `9${String(Date.now()).slice(-8)}${index++}`,
        },
      });
      assert.equal(signup.statusCode, 200, signup.body);
      const verification = await app.inject({
        method: "POST",
        url: "/api/auth/email-otp/verify-email",
        headers,
        payload: { email, otp: mail.lastCode(email) },
      });
      assert.equal(verification.statusCode, 200, verification.body);
      actors[role] = {
        email,
        id: verification.json().user.id,
        cookie: verification.cookies
          .map((cookie) => `${cookie.name}=${cookie.value}`)
          .join("; "),
      };
    }
    const firm = await app.inject({
      method: "POST",
      url: "/v1/firms",
      headers: { cookie: actors.owner.cookie },
      payload: {
        name: `Security ${randomUUID()}`,
        city: "Delhi",
        stateCode: "07",
        gstRegistration: "unregistered",
      },
    });
    assert.equal(firm.statusCode, 201, firm.body);
    const firmId: string = firm.json().id;
    await db.insert(schema.member).values(
      ["accountant", "sales", "viewer"].map((role) => ({
        organizationId: firmId,
        userId: actors[role as Role].id,
        role,
      })),
    );
    const headers = (role: Role | "outsider", version = 1) => ({
      cookie: actors[role].cookie,
      "x-firm-id": firmId,
      "if-match": String(version),
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    });
    const party = (
      type: PartyInput["type"],
      name = randomUUID(),
    ): PartyInput => ({
      name: `Fixture ${name}`,
      type,
      city: "Delhi",
      stateCode: "07",
      phone: "",
      creditDays: 0,
      creditLimit: 0,
      openingBalance: type === "supplier" ? -10_000 : 10_000,
    });
    async function create(type: PartyInput["type"]) {
      const input = party(type);
      const response = await app.inject({
        method: "POST",
        url: "/v1/parties",
        headers: headers("owner"),
        payload: input,
      });
      assert.equal(response.statusCode, 201, response.body);
      return { input, row: response.json<PartyRow>() };
    }
    async function snapshot() {
      const rows = await pool.query(
        `select
      (select jsonb_agg(to_jsonb(p) order by p.id) from parties p where firm_id = $1) as parties,
      (select count(*) from postings where firm_id = $1) as postings,
      (select count(*) from change_log where firm_id = $1) as changes,
      (select count(*) from operation_receipts where user_id in (select user_id from member where organization_id = $1)) as operations,
      (select count(*) from idempotency_keys where user_id in (select user_id from member where organization_id = $1)) as retries`,
        [firmId],
      );
      return rows.rows[0];
    }
    const supplier = await create("supplier");
    const customer = await create("customer");

    await t.test(
      "sales cannot create/edit/delete suppliers or convert either party type",
      async () => {
        const before = await snapshot();
        for (const request of [
          {
            method: "POST" as const,
            url: "/v1/parties",
            payload: party("supplier"),
          },
          {
            method: "PUT" as const,
            url: `/v1/parties/${supplier.row.id}`,
            payload: { ...supplier.input, openingBalance: -20_000 },
          },
          {
            method: "PUT" as const,
            url: `/v1/parties/${supplier.row.id}`,
            payload: { ...supplier.input, type: "customer" },
          },
          {
            method: "PUT" as const,
            url: `/v1/parties/${customer.row.id}`,
            payload: { ...customer.input, type: "supplier" },
          },
          { method: "DELETE" as const, url: `/v1/parties/${supplier.row.id}` },
        ]) {
          const response = await app.inject({
            ...request,
            headers: headers("sales"),
          });
          assert.equal(response.statusCode, 403, response.body);
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "operations authorize execute, lookup and cancel without storing forbidden receipts",
      async () => {
        const before = await snapshot();
        for (const suffix of ["", "/lookup", "/cancel"]) {
          for (const input of [
            { method: "POST", path: "/parties", body: party("supplier") },
            {
              method: "PUT",
              path: `/parties/${supplier.row.id}`,
              expectedVersion: 1,
              body: { ...supplier.input, type: "customer" },
            },
            {
              method: "PUT",
              path: `/parties/${customer.row.id}`,
              expectedVersion: 1,
              body: { ...customer.input, type: "supplier" },
            },
          ]) {
            const response = await app.inject({
              method: "POST",
              url: `/v1/operations/${newRequestId(randomUUID())}${suffix}`,
              headers: headers("sales"),
              payload: { ...input, role: "sales" },
            });
            assert.equal(response.statusCode, 403, response.body);
          }
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "sync rejects all supplier mutations without changing retry answers",
      async () => {
        const before = await snapshot();
        const mutations: SyncPushMutation[] = [
          {
            entity: "party",
            operation: "create",
            data: party("supplier"),
            clientMutationId: newRequestId(randomUUID()),
          },
          {
            entity: "party",
            operation: "update",
            id: supplier.row.id,
            baseVersion: 1,
            data: { ...supplier.input, openingBalance: -20_000 },
            clientMutationId: newRequestId(randomUUID()),
          },
          {
            entity: "party",
            operation: "update",
            id: supplier.row.id,
            baseVersion: 1,
            data: { ...supplier.input, type: "customer" },
            clientMutationId: newRequestId(randomUUID()),
          },
          {
            entity: "party",
            operation: "update",
            id: customer.row.id,
            baseVersion: 1,
            data: { ...customer.input, type: "supplier" },
            clientMutationId: newRequestId(randomUUID()),
          },
          {
            entity: "party",
            operation: "delete",
            id: supplier.row.id,
            baseVersion: 1,
            clientMutationId: newRequestId(randomUUID()),
          },
        ];
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await app.inject({
            method: "POST",
            url: "/v1/sync/push",
            headers: headers("sales"),
            payload: { mutations },
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.equal(response.json().applied.length, 0);
          assert.deepEqual(
            response
              .json()
              .conflicts.map((conflict: { code: string; current: unknown }) => [
                conflict.code,
                conflict.current,
              ]),
            mutations.map(() => ["FORBIDDEN", null]),
          );
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "permitted customer and supplier workflows still work through every path",
      async () => {
        for (const role of ["owner", "accountant", "sales"] as const) {
          const type = role === "sales" ? "customer" : "supplier";
          const direct = await app.inject({
            method: "POST",
            url: "/v1/parties",
            headers: headers(role),
            payload: party(type),
          });
          assert.equal(direct.statusCode, 201, direct.body);
          const saved = direct.json<PartyRow>();
          const updated = await app.inject({
            method: "PUT",
            url: `/v1/parties/${saved.id}`,
            headers: headers(role),
            payload: { ...saved, city: "Mumbai" },
          });
          assert.equal(updated.statusCode, 200, updated.body);
          const removed = await app.inject({
            method: "DELETE",
            url: `/v1/parties/${saved.id}`,
            headers: headers(role, 2),
          });
          assert.equal(removed.statusCode, 200, removed.body);
          const input = {
            method: "POST",
            path: "/parties",
            role,
            body: party(type),
          };
          const url = `/v1/operations/${newRequestId(randomUUID())}`;
          const operation = await app.inject({
            method: "POST",
            url,
            headers: headers(role),
            payload: input,
          });
          assert.equal(operation.json().state, "committed", operation.body);
          const replayed = await app.inject({
            method: "POST",
            url,
            headers: headers(role),
            payload: input,
          });
          assert.deepEqual(replayed.json(), operation.json());
          const mutation = {
            entity: "party",
            operation: "create",
            data: party(type),
            clientMutationId: newRequestId(randomUUID()),
          };
          const sync = await app.inject({
            method: "POST",
            url: "/v1/sync/push",
            headers: headers(role),
            payload: { mutations: [mutation] },
          });
          assert.equal(sync.json().applied.length, 1, sync.body);
          const replay = await app.inject({
            method: "POST",
            url: "/v1/sync/push",
            headers: headers(role),
            payload: { mutations: [mutation] },
          });
          assert.deepEqual(replay.json(), sync.json());
        }
      },
    );

    await t.test(
      "viewer writes and forged membership remain forbidden",
      async () => {
        const before = await snapshot();
        for (const role of ["viewer", "outsider"] as const) {
          const response = await app.inject({
            method: "POST",
            url: "/v1/parties",
            headers: headers(role),
            payload: party("customer"),
          });
          assert.equal(response.statusCode, 403, response.body);
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "a new recovery epoch blocks old pending work even after fresh login",
      async () => {
        const epoch = randomUUID();
        const restored = await buildApp({
          db,
          email: mail.sender,
          env: {
            NODE_ENV: "test",
            LOG_LEVEL: "silent",
            RECOVERY_EPOCH: epoch,
            BETTER_AUTH_SECRET:
              "security-fixture-secret-which-is-never-used-outside-tests",
            BETTER_AUTH_URL: "http://localhost:3000",
            TRUSTED_ORIGINS: ["http://localhost:3000"],
            SENTRY_TRACES_SAMPLE_RATE: 0,
          },
        });
        try {
          const login = await restored.inject({
            method: "POST",
            url: "/api/auth/sign-in/email",
            headers: {
              origin: "http://localhost:3000",
              "x-platform": "web",
              "x-confirm-takeover": "true",
            },
            payload: {
              email: actors.owner.email,
              password: "Only-a-disposable-test-123!",
            },
          });
          assert.equal(login.statusCode, 200, login.body);
          const cookie = login.cookies
            .map((entry) => `${entry.name}=${entry.value}`)
            .join("; ");
          const before = await snapshot();
          for (const oldEpoch of [undefined, DEVELOPMENT_RECOVERY_EPOCH]) {
            const staleHeaders = {
              cookie,
              "x-firm-id": firmId,
              ...(oldEpoch ? { [RECOVERY_EPOCH_HEADER]: oldEpoch } : {}),
            };
            for (const suffix of [
              "",
              "/lookup",
              "/cancel",
              "/document-reservation",
            ]) {
              const response = await restored.inject({
                method: "POST",
                url: `/v1/operations/${newRequestId(randomUUID())}${suffix}`,
                headers: staleHeaders,
                payload: {
                  method: "POST",
                  path: "/parties",
                  role: "owner",
                  body: party("customer"),
                },
              });
              assert.equal(response.statusCode, 409, response.body);
              assert.equal(response.json().error.code, "RECOVERY_REQUIRED");
              assert.equal(response.headers[RECOVERY_EPOCH_HEADER], epoch);
            }
            const sync = await restored.inject({
              method: "POST",
              url: "/v1/sync/push",
              headers: staleHeaders,
              payload: {
                mutations: [
                  {
                    clientMutationId: newRequestId(randomUUID()),
                    entity: "party",
                    operation: "create",
                    data: party("customer"),
                  },
                ],
              },
            });
            assert.equal(sync.statusCode, 409, sync.body);
            const direct = await restored.inject({
              method: "POST",
              url: "/v1/parties",
              headers: {
                ...staleHeaders,
                "idempotency-key": newRequestId(randomUUID()),
              },
              payload: party("customer"),
            });
            assert.equal(direct.statusCode, 409, direct.body);
          }
          assert.deepEqual(await snapshot(), before);
          const currentHeaders = {
            cookie,
            "x-firm-id": firmId,
            [RECOVERY_EPOCH_HEADER]: epoch,
          };
          const oldCursor = await restored.inject({
            url: "/v1/sync/changes?since=9000000000000",
            headers: currentHeaders,
          });
          assert.equal(oldCursor.statusCode, 409, oldCursor.body);
          assert.equal(oldCursor.json().error.code, "SYNC_CURSOR_RESET");
          const fresh = await restored.inject({
            method: "POST",
            url: `/v1/operations/${newRequestId(randomUUID())}`,
            headers: currentHeaders,
            payload: {
              method: "POST",
              path: "/parties",
              role: "owner",
              body: party("customer"),
            },
          });
          assert.equal(fresh.json().state, "committed", fresh.body);
          const preflight = await restored.inject({
            method: "OPTIONS",
            url: "/v1/sync/push",
            headers: {
              origin: "http://localhost:3000",
              "access-control-request-method": "POST",
              "access-control-request-headers": RECOVERY_EPOCH_HEADER,
            },
          });
          assert.equal(preflight.statusCode, 204);
          assert.match(
            String(preflight.headers["access-control-allow-headers"]),
            /x-recovery-epoch/i,
          );
          assert.match(
            String(fresh.headers["access-control-expose-headers"]),
            /x-recovery-epoch/i,
          );
        } finally {
          await restored.close();
        }
      },
    );
  },
);
