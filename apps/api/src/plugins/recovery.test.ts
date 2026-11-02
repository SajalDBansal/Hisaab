import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import { registerErrorHandling } from "./errors";
import { recoveryEpoch, registerRecoveryEpoch } from "./recovery";
import { readEnv } from "../config/env";

test("the recovery epoch is stable locally and mandatory in production", () => {
  assert.equal(recoveryEpoch(undefined, false), DEVELOPMENT_RECOVERY_EPOCH);
  assert.throws(() => recoveryEpoch(undefined, true), /RECOVERY_EPOCH/);
  assert.throws(
    () => recoveryEpoch(DEVELOPMENT_RECOVERY_EPOCH, true),
    /RECOVERY_EPOCH/,
  );
  assert.throws(() => recoveryEpoch("invalid", false));
  const epoch = randomUUID();
  assert.equal(recoveryEpoch(epoch, true), epoch);
  const settings = {
    NODE_ENV: "production",
    APP_MODE: "recovery",
    DATABASE_URL: "postgres://localhost/fixture",
    BETTER_AUTH_SECRET:
      "local-environment-validation-fixture-with-32-characters",
    BETTER_AUTH_URL: "https://api.example.invalid",
    TRUSTED_ORIGINS: "https://app.example.invalid",
  };
  assert.throws(() => readEnv(settings), /RECOVERY_EPOCH/);
  assert.equal(
    readEnv({ ...settings, RECOVERY_EPOCH: epoch }).RECOVERY_EPOCH,
    epoch,
  );
});

test("old and absent epochs cannot enter retry handlers; fresh reads still work", async (t) => {
  const app = Fastify({ logger: false });
  t.after(() => app.close());
  const epoch = randomUUID();
  registerErrorHandling(app);
  registerRecoveryEpoch(app, epoch);
  let entered = 0;
  const handler = async () => {
    entered++;
    return { ok: true };
  };
  app.post("/v1/operations/:key", handler);
  app.post("/v1/operations/:key/lookup", handler);
  app.post("/v1/operations/:key/cancel", handler);
  app.post("/v1/operations/:key/document-reservation", handler);
  app.post("/v1/sync/push", handler);
  app.post("/v1/sales", handler);
  app.get("/v1/sync/changes", handler);
  app.get("/health", async () => ({ ok: true }));
  for (const url of [
    "/v1/operations/fixture",
    "/v1/operations/fixture/lookup",
    "/v1/operations/fixture/cancel",
    "/v1/operations/fixture/document-reservation",
    "/v1/sync/push",
    "/v1/sales",
  ]) {
    for (const stale of [undefined, randomUUID(), "invalid"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          "idempotency-key": "fixture-original-key",
          ...(stale ? { [RECOVERY_EPOCH_HEADER]: stale } : {}),
        },
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error.code, "RECOVERY_REQUIRED");
      assert.equal(response.headers[RECOVERY_EPOCH_HEADER], epoch);
    }
  }
  const cursor = await app.inject({ url: "/v1/sync/changes?since=5" });
  assert.equal(cursor.statusCode, 409);
  assert.equal(entered, 0);
  const health = await app.inject({ url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers[RECOVERY_EPOCH_HEADER], epoch);
  const firstRead = await app.inject({ url: "/v1/sync/changes?since=0" });
  assert.equal(firstRead.statusCode, 200);
  const fresh = await app.inject({
    method: "POST",
    url: "/v1/operations/fixture",
    headers: { [RECOVERY_EPOCH_HEADER]: epoch },
  });
  assert.equal(fresh.statusCode, 200);
  const oldKeyless = await app.inject({
    method: "POST",
    url: "/v1/sales",
    headers: { [RECOVERY_EPOCH_HEADER]: randomUUID() },
  });
  assert.equal(oldKeyless.statusCode, 409);
});
