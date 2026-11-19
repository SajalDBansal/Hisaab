import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
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

/** RFC 6238 code for an otpauth:// URI, computed here so the test trusts no library. */
function totpFor(uri: string, at = Date.now()) {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, ""))
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 15;
  const value = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
}

/** One browser or phone: keeps its own cookies like a real client. */
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    has: (name: string) => [...jar.keys()].some((k) => k.endsWith(name)),
    take(setCookie: string | string[] | undefined) {
      for (const cookie of [setCookie ?? []].flat()) {
        const [pair = ""] = cookie.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1);
        if (!value || /max-age=0/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}
type Jar = ReturnType<typeof cookieJar>;

// Only the explicitly supplied disposable database; never .env.
test(
  "two-factor sign-in: TOTP, recovery codes and the firm requirement (T58)",
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
        BETTER_AUTH_SECRET: "two-factor-fixture-only-secret-not-for-users",
        BETTER_AUTH_URL: "http://localhost:3000",
        TRUSTED_ORIGINS: ["http://localhost:8081"],
        SENTRY_TRACES_SAMPLE_RATE: 0,
      },
    });
    const tag = randomUUID().slice(0, 8);
    const base = {
      origin: "http://localhost:8081",
      [RECOVERY_EPOCH_HEADER]: DEVELOPMENT_RECOVERY_EPOCH,
    };
    const password = "Fixture-password-123!";
    let firmId = "";

    const send = async (
      jar: Jar,
      method: "GET" | "POST" | "PUT",
      path: string,
      payload?: object,
      extra: Record<string, string> = {},
    ) => {
      const reply = await app.inject({
        method,
        url: path,
        headers: {
          ...base,
          cookie: jar.header(),
          ...(firmId && path.startsWith("/v1/") ? { "x-firm-id": firmId } : {}),
          ...(method !== "GET" && path.startsWith("/v1/")
            ? { "idempotency-key": newRequestId(randomUUID()) }
            : {}),
          ...extra,
        },
        payload,
      });
      jar.take(reply.headers["set-cookie"]);
      return reply;
    };
    const ok = async <T>(
      jar: Jar,
      method: "GET" | "POST" | "PUT",
      path: string,
      payload?: object,
      extra?: Record<string, string>,
    ) => {
      const reply = await send(jar, method, path, payload, extra);
      assert.ok(
        reply.statusCode < 300,
        `${path}: ${reply.statusCode} ${reply.body}`,
      );
      return reply.json<T>();
    };
    const codeOf = (reply: { json: () => unknown }) => {
      const body = reply.json() as {
        code?: string;
        error?: { code?: string };
      };
      return body.error?.code ?? body.code;
    };
    const signUp = async (email: string) => {
      const jar = cookieJar();
      await ok(jar, "POST", "/api/auth/sign-up/email", {
        name: email.split("@")[0],
        email,
        password,
        phoneNumber: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      });
      await ok(jar, "POST", "/api/auth/email-otp/verify-email", {
        email,
        otp: mail.lastCode(email),
      });
      return jar;
    };

    try {
      const ownerEmail = `tfa-owner-${tag}@example.invalid`;
      const owner = await signUp(ownerEmail);
      const firm = await ok<{ id: string }>(owner, "POST", "/v1/firms", {
        name: `TFA ${tag}`,
        city: "Delhi",
        stateCode: "07",
        gstin: "07AAAAA0000A1Z4",
        gstRegistration: "regular",
      });
      firmId = firm.id;
      assert.deepEqual(await ok(owner, "GET", "/v1/me/two-factor"), {
        enabled: false,
        recoveryCodesLeft: 0,
      });

      // Owner guard: two-factor must be on for the owner before requiring it.
      const early = await send(
        owner,
        "PUT",
        "/v1/settings/security",
        { requireTwoFactor: true },
        { "if-match": "0" },
      );
      assert.equal(early.statusCode, 409, early.body);
      assert.equal(codeOf(early), "TWO_FACTOR_SETUP_FIRST");

      // ---- Turning it on -------------------------------------------------
      const wrongPassword = await send(
        owner,
        "POST",
        "/api/auth/two-factor/enable",
        { password: "not-the-password" },
      );
      assert.equal(wrongPassword.statusCode, 400, wrongPassword.body);
      const setup = await ok<{ totpURI: string; backupCodes: string[] }>(
        owner,
        "POST",
        "/api/auth/two-factor/enable",
        { password },
      );
      assert.match(setup.totpURI, /^otpauth:\/\/totp\/Hisaab:/);
      assert.equal(setup.backupCodes.length, 10);
      // Not on until a code from the app proves the setup worked
      assert.equal(
        (await ok<{ twoFactorEnabled?: boolean }>(owner, "GET", "/v1/me"))
          .twoFactorEnabled,
        false,
      );
      const badCode = await send(
        owner,
        "POST",
        "/api/auth/two-factor/verify-totp",
        {
          code: totpFor(setup.totpURI, Date.now() - 10 * 60_000),
        },
      );
      assert.equal(badCode.statusCode, 401, badCode.body);
      await ok(owner, "POST", "/api/auth/two-factor/verify-totp", {
        code: totpFor(setup.totpURI),
      });
      assert.equal(
        (await ok<{ twoFactorEnabled?: boolean }>(owner, "GET", "/v1/me"))
          .twoFactorEnabled,
        true,
      );
      assert.deepEqual(await ok(owner, "GET", "/v1/me/two-factor"), {
        enabled: true,
        recoveryCodesLeft: 10,
      });

      // ---- Sign-in asks for the code ----------------------------------------
      const takeover = { "x-confirm-takeover": "true" };
      const phone = cookieJar();
      const challenge = await ok<{
        twoFactorRedirect?: boolean;
        twoFactorMethods?: string[];
        token?: string;
      }>(
        phone,
        "POST",
        "/api/auth/sign-in/email",
        { email: ownerEmail, password },
        takeover,
      );
      assert.equal(challenge.twoFactorRedirect, true);
      assert.deepEqual(challenge.twoFactorMethods, ["totp"]);
      assert.equal(challenge.token, undefined);
      assert.ok(phone.has("two_factor"));
      // The password alone gives no session, and doesn't log out the other device.
      assert.equal((await send(phone, "GET", "/v1/me")).statusCode, 401);
      assert.equal((await send(owner, "GET", "/v1/me")).statusCode, 200);
      // Trusted devices are not offered: the flag is dropped.
      await ok(
        phone,
        "POST",
        "/api/auth/two-factor/verify-totp",
        { code: totpFor(setup.totpURI), trustDevice: true },
        takeover,
      );
      assert.ok(!phone.has("trust_device"));
      assert.equal((await send(phone, "GET", "/v1/me")).statusCode, 200);
      // One session per platform still holds once the code was right.
      const replaced = await send(owner, "GET", "/v1/me");
      assert.equal(replaced.statusCode, 401);
      assert.equal(codeOf(replaced), "SESSION_REPLACED");

      // Email-code sign-in can't skip the authenticator.
      await ok(
        cookieJar(),
        "POST",
        "/api/auth/email-otp/send-verification-otp",
        {
          email: ownerEmail,
          type: "sign-in",
        },
      );
      const viaEmail = await send(
        cookieJar(),
        "POST",
        "/api/auth/sign-in/email-otp",
        {
          email: ownerEmail,
          otp: mail.lastCode(ownerEmail),
        },
      );
      assert.equal(viaEmail.statusCode, 403, viaEmail.body);
      assert.equal(codeOf(viaEmail), "TWO_FACTOR_SIGN_IN");

      // ---- A recovery code instead of the app -----------------------------
      const [recovery] = setup.backupCodes;
      assert.ok(recovery);
      const browser = cookieJar();
      await ok(
        browser,
        "POST",
        "/api/auth/sign-in/email",
        {
          email: ownerEmail,
          password,
        },
        { "x-platform": "web" },
      );
      await ok(
        browser,
        "POST",
        "/api/auth/two-factor/verify-backup-code",
        {
          code: recovery,
        },
        { "x-platform": "web" },
      );
      assert.deepEqual(await ok(browser, "GET", "/v1/me/two-factor"), {
        enabled: true,
        recoveryCodesLeft: 9,
      });
      // Each recovery code works once.
      const again = cookieJar();
      await ok(
        again,
        "POST",
        "/api/auth/sign-in/email",
        {
          email: ownerEmail,
          password,
        },
        { "x-platform": "web", ...takeover },
      );
      const reused = await send(
        again,
        "POST",
        "/api/auth/two-factor/verify-backup-code",
        {
          code: recovery,
        },
        { "x-platform": "web", ...takeover },
      );
      assert.equal(reused.statusCode, 401, reused.body);
      // Showing the codes again needs the password.
      const peek = await send(
        browser,
        "POST",
        "/v1/me/two-factor/recovery-codes",
        {
          password: "not-the-password",
        },
      );
      assert.ok(peek.statusCode >= 400, peek.body);
      const shown = await ok<{ codes: string[] }>(
        browser,
        "POST",
        "/v1/me/two-factor/recovery-codes",
        { password },
      );
      assert.equal(shown.codes.length, 9);
      assert.ok(!shown.codes.includes(recovery));
      // New codes replace the old ones.
      const fresh = await ok<{ backupCodes: string[] }>(
        browser,
        "POST",
        "/api/auth/two-factor/generate-backup-codes",
        { password },
      );
      assert.equal(fresh.backupCodes.length, 10);
      assert.ok(!fresh.backupCodes.includes(shown.codes[0] ?? ""));

      // ---- The firm requirement ---------------------------------------------
      const required = await ok<{ requireTwoFactor: boolean; version: number }>(
        browser,
        "PUT",
        "/v1/settings/security",
        { requireTwoFactor: true },
        { "if-match": "0" },
      );
      assert.deepEqual(required, { requireTwoFactor: true, version: 1 });
      const stale = await send(
        browser,
        "PUT",
        "/v1/settings/security",
        { requireTwoFactor: false },
        { "if-match": "0" },
      );
      assert.equal(stale.statusCode, 409, stale.body);
      assert.equal(codeOf(stale), "EDITED_ELSEWHERE");

      const memberEmail = `tfa-member-${tag}@example.invalid`;
      await ok(browser, "POST", "/v1/firms/current/invitations", {
        email: memberEmail,
        role: "accountant",
      });
      const member = await signUp(memberEmail);
      const memberFirm = firmId;
      firmId = "";
      const [invite] = await ok<{ id: string }[]>(
        member,
        "GET",
        "/v1/me/invitations",
      );
      assert.ok(invite);
      await ok(member, "POST", `/v1/me/invitations/${invite.id}/accept`);
      const listed = await ok<{ id: string; twoFactorRequired?: boolean }[]>(
        member,
        "GET",
        "/v1/firms",
      );
      assert.equal(
        listed.find((f) => f.id === memberFirm)?.twoFactorRequired,
        true,
      );
      firmId = memberFirm;
      for (const path of [
        "/v1/firms/current",
        "/v1/parties",
        "/v1/settings/security",
      ]) {
        const refused = await send(member, "GET", path);
        assert.equal(refused.statusCode, 403, `${path}: ${refused.body}`);
        assert.equal(codeOf(refused), "TWO_FACTOR_REQUIRED");
      }
      const liveTicket = await send(member, "POST", "/v1/live/ticket", {});
      assert.equal(codeOf(liveTicket), "TWO_FACTOR_REQUIRED");
      // Account routes stay open so the member can turn it on.
      const memberSetup = await ok<{ totpURI: string }>(
        member,
        "POST",
        "/api/auth/two-factor/enable",
        { password },
      );
      await ok(member, "POST", "/api/auth/two-factor/verify-totp", {
        code: totpFor(memberSetup.totpURI),
      });
      await ok(member, "GET", "/v1/firms/current");
      // Only the owner changes the requirement.
      const notOwner = await send(
        member,
        "PUT",
        "/v1/settings/security",
        { requireTwoFactor: false },
        { "if-match": "1" },
      );
      assert.equal(notOwner.statusCode, 403, notOwner.body);

      // ---- Turning it off needs a code as well as the password --------------
      const noCode = await send(
        member,
        "POST",
        "/api/auth/two-factor/disable",
        {
          password,
        },
      );
      assert.equal(noCode.statusCode, 401, noCode.body);
      assert.equal(codeOf(noCode), "INVALID_CODE");
      const wrongCode = await send(
        member,
        "POST",
        "/api/auth/two-factor/disable",
        {
          password,
          code: "000000" === totpFor(memberSetup.totpURI) ? "111111" : "000000",
        },
      );
      assert.equal(wrongCode.statusCode, 401, wrongCode.body);
      await ok(member, "POST", "/api/auth/two-factor/disable", {
        password,
        code: totpFor(memberSetup.totpURI),
      });
      assert.equal(
        (await ok<{ twoFactorEnabled?: boolean }>(member, "GET", "/v1/me"))
          .twoFactorEnabled,
        false,
      );
      // ...and the firm is closed to them again.
      assert.equal(
        codeOf(await send(member, "GET", "/v1/firms/current")),
        "TWO_FACTOR_REQUIRED",
      );

      // The owner can lift the requirement.
      await ok(
        browser,
        "PUT",
        "/v1/settings/security",
        { requireTwoFactor: false },
        { "if-match": "1" },
      );
      await ok(member, "GET", "/v1/firms/current");
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
