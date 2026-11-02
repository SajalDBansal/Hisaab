import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { DrizzleQueryError, sql } from "drizzle-orm";
import type * as Sentry from "@sentry/node";
import { createDb } from "@repo/backend/db/client";
import {
  createErrorReporter,
  logErrorReporter,
} from "@repo/backend/lib/observability";
import { safeError, safeErrorContext } from "@repo/backend/lib/safe-error";
import { authLogger } from "../auth/logging";
import { registerErrorHandling } from "./errors";
import { registerObservability } from "./observability";

const markers = [
  "fixture-password-83!",
  "fixture-session-token-97",
  "private-fixture@example.invalid",
  "finance-value-739182",
];
const secret = markers.join(" ");

function databaseError() {
  const cause = Object.assign(new Error(`invalid input: ${secret}`), {
    code: "22P02",
    detail: secret,
    where: secret,
    stack: `Error: ${secret}\n at ${secret}`,
  });
  return new DrizzleQueryError(`select '${secret}'`, markers, cause);
}

function assertPrivate(value: unknown) {
  const output = JSON.stringify(value);
  for (const marker of markers)
    assert.equal(
      output.includes(marker),
      false,
      "Diagnostic leaked a synthetic marker",
    );
}

test("safe diagnostics retain codes but omit values in errors, causes and aggregates", () => {
  const error = new AggregateError(
    [databaseError(), new Error(secret)],
    secret,
  );
  Object.assign(error, {
    cause: error,
    request: { body: secret },
    token: secret,
  });
  const safe = safeError(error);
  assertPrivate(safe);
  assert.equal(safe.type, "AggregateError");
  assert.equal(safe.errors?.[0]?.cause?.code, "22P02");
  assert.equal(
    safeError(Object.assign(new Error(secret), { code: "ECONNRESET" })).code,
    "ECONNRESET",
  );
  assertPrivate(
    safeErrorContext({
      requestId: "fixture-request",
      params: markers,
      body: secret,
      password: secret,
    }),
  );
});

test("Fastify handler, reporting hook and library logger never log raw database errors", async (t) => {
  let output = "";
  const app = Fastify({
    logger: {
      level: "info",
      serializers: { err: safeError },
      stream: {
        write: (line: string) => {
          output += line;
        },
      },
    },
  });
  t.after(() => app.close());
  registerErrorHandling(app);
  registerObservability(app);
  app.get("/fault", async () => {
    throw databaseError();
  });
  const response = await app.inject({
    url: "/fault",
    headers: { "x-request-id": "fixture-request" },
  });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.code, "SERVER_ERROR");
  authLogger(app.log).log("error", `Failed signup ${secret}`, databaseError(), {
    password: secret,
  });
  logErrorReporter(app.log).capture(databaseError(), {
    requestId: "fixture-request",
    route: "/fault",
    params: markers,
  });
  assertPrivate(output);
  assert.match(output, /22P02/);
  assert.match(output, /Captured error/);
  assert.match(output, /Unhandled error/);
  assert.match(output, /Authentication diagnostic/);
  assert.match(output, /fixture-request/);
});

test("Sentry receives a new sanitized exception and allowlisted context", () => {
  const events: unknown[] = [];
  let options: Sentry.NodeOptions | undefined;
  const client = {
    init: (value: Sentry.NodeOptions) => {
      options = value;
    },
    withScope: (callback: (scope: unknown) => void) =>
      callback({
        setTag: (key: string, value: string) => events.push({ key, value }),
        setExtras: (extras: unknown) => events.push(extras),
      }),
    captureException: (error: Error) => {
      events.push({
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause,
      });
    },
  } as unknown as Pick<
    typeof Sentry,
    "init" | "withScope" | "captureException"
  >;
  const log = {
    error: (fields: unknown) => {
      events.push(fields);
    },
  } as unknown as FastifyBaseLogger;
  const reporter = createErrorReporter(
    log,
    {
      dsn: "https://fixture@example.invalid/1",
      environment: "test",
      service: "api",
      tracesSampleRate: 0,
    },
    client,
  );
  reporter.capture(databaseError(), {
    requestId: "fixture-request",
    route: "/parties",
    query: secret,
    params: markers,
  });
  assertPrivate(events);
  assert.match(JSON.stringify(events), /22P02/);
  assert.equal(options?.defaultIntegrations, false);
  const beforeSend = options?.beforeSend;
  assert.ok(beforeSend);
  const sanitized = beforeSend(
    {
      type: undefined,
      request: { data: secret },
      user: { email: markers[2] },
      breadcrumbs: [{ message: secret }],
      contexts: { private: { secret } },
      tags: { password: secret },
      extra: { password: secret, error: safeError(databaseError()) },
    },
    {},
  );
  assertPrivate(sanitized);
  assert.match(JSON.stringify(sanitized), /22P02/);
});

test(
  "real PostgreSQL bound values stay out of HTTP error logs",
  {
    skip: !process.env.SECURITY_TEST_DATABASE_URL,
  },
  async (t) => {
    assert.ok(process.env.SECURITY_TEST_DATABASE_URL);
    const url = new URL(process.env.SECURITY_TEST_DATABASE_URL);
    assert.equal(url.pathname, "/hardening_security");
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const { db, pool } = createDb(url.toString());
    let output = "";
    const app = Fastify({
      logger: {
        level: "info",
        serializers: { err: safeError },
        stream: {
          write: (line: string) => {
            output += line;
          },
        },
      },
    });
    t.after(async () => {
      await app.close();
      await pool.end();
    });
    registerErrorHandling(app);
    registerObservability(app);
    app.get("/postgres-fault", async () =>
      db.execute(sql`select ${secret}::integer`),
    );
    const response = await app.inject({ url: "/postgres-fault" });
    assert.equal(response.statusCode, 500);
    assertPrivate(output);
    assert.match(output, /22P02/);
  },
);
