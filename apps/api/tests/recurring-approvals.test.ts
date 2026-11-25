import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  DEVELOPMENT_RECOVERY_EPOCH,
  RECOVERY_EPOCH_HEADER,
  newRequestId,
} from "@repo/contracts";
import { addDays } from "@repo/core";
import { createDb, schema } from "@repo/backend/db/client";
import { runRecurring } from "@repo/backend/modules/recurring/recurring.repo";
import { buildApp } from "../src/app";
import { memorySender } from "../src/lib/email";
import { fakeStorage } from "../src/lib/storage";

type Entry = {
  id: string;
  status: string;
  version: number;
  date: string;
  input: Record<string, unknown>;
  rejectReason: string | null;
  voucherId: string | null;
  history: { action: string }[];
};
type EntryList = {
  entries: Entry[];
  counts: { drafts: number; submitted: number; rejected: number };
  canApprove: boolean;
};

// Only the explicitly supplied disposable database; never .env.
test(
  "recurring drafts and approvals: drafts once per date, nothing posts until saved or approved (T03, T06)",
  { skip: !process.env.HISAAB_DATA_TEST_URL, timeout: 180_000 },
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
        BETTER_AUTH_SECRET: "recurring-fixture-only-secret-not-for-users",
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
        const email = `recurring-${tag}-${suffix}@example.invalid`;
        const signup = await app.inject({
          method: "POST",
          url: "/api/auth/sign-up/email",
          headers,
          payload: {
            name: `Rec ${suffix}`,
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
      const clerk = await account("clerk");
      let firmId = "";
      type Method = "GET" | "POST" | "PUT" | "DELETE";
      const call = (
        who: { cookie: string },
        method: Method,
        path: string,
        payload?: object,
        version?: number,
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
            ...(version !== undefined ? { "if-match": `"${version}"` } : {}),
          },
          payload,
        });
      const ok = async <T>(
        who: { cookie: string },
        method: Method,
        path: string,
        payload?: object,
        version?: number,
      ) => {
        const reply = await call(who, method, path, payload, version);
        assert.ok(
          reply.statusCode < 300,
          `${method} ${path}: ${reply.statusCode} ${reply.body}`,
        );
        return reply.statusCode === 204 ? (undefined as T) : reply.json<T>();
      };

      firmId = (
        await ok<{ id: string }>(owner, "POST", "/v1/firms", {
          name: `Recurring ${tag}`,
          city: "Delhi",
          stateCode: "07",
          gstRegistration: "unregistered",
        })
      ).id;
      await db
        .insert(schema.member)
        .values({
          organizationId: firmId,
          userId: clerk.id,
          role: "accountant",
        });
      const supplier = await ok<{ id: string }>(owner, "POST", "/v1/parties", {
        name: `Landlord ${tag}`,
        type: "supplier",
        phone: "",
        city: "Delhi",
        stateCode: "07",
        gstin: "",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
      });
      const [cash] = await ok<{ id: string }[]>(
        owner,
        "GET",
        "/v1/ledgers?kind=cash",
      );
      assert.ok(cash);
      const { fyStart } = await ok<{ fyStart: string }>(
        owner,
        "GET",
        "/v1/firms/current",
      );
      const today = new Date().toISOString().slice(0, 10);
      const twoBack = addDays(today, -2);
      // The schedule below needs three days in this financial year.
      if (twoBack < fyStart) return;
      const payment = (amount: number, date = today) => ({
        partyId: supplier.id,
        date,
        amount,
        mode: "cash",
        ledgerId: cash.id,
        allocations: [],
      });
      const payments = async () =>
        (
          await ok<{ items: unknown[] }>(
            owner,
            "GET",
            "/v1/vouchers?type=payment&limit=200",
          )
        ).items.length;

      // ---- T03: recurring ----------------------------------------------------
      const rent = await ok<{ id: string; number: string }>(
        owner,
        "POST",
        "/v1/payments",
        payment(50_000, twoBack),
      );
      // A template is checked against the voucher's own input.
      const bad = await call(owner, "POST", "/v1/recurring", {
        name: "Broken",
        voucherType: "payment",
        frequency: "monthly",
        startDate: today,
        template: { partyId: supplier.id, amount: 100, mode: "cash" },
      });
      assert.equal(bad.statusCode, 400, bad.body);
      const schedule = await ok<{
        id: string;
        nextDate: string;
        template: Record<string, unknown>;
        version: number;
      }>(owner, "POST", `/v1/recurring/from-voucher/${rent.id}`, {
        name: "Daily rent",
        frequency: "daily",
        interval: 1,
        startDate: twoBack,
      });
      assert.equal(schedule.nextDate, twoBack);
      assert.equal(schedule.template.amount, 50_000);
      assert.equal(schedule.template.date, undefined);
      assert.deepEqual(schedule.template.allocations, []);

      // Books closed through two days back: that date is skipped, not drafted.
      await db
        .insert(schema.bookControls)
        .values({ firmId, closedThrough: twoBack })
        .onConflictDoUpdate({
          target: schema.bookControls.firmId,
          set: { closedThrough: twoBack },
        });
      const now = new Date(`${today}T12:00:00+05:30`);
      // Two workers at once, then a retry: one draft per date all the same.
      await Promise.all([runRecurring(db, now), runRecurring(db, now)]);
      await runRecurring(db, now);
      const drafts = await db
        .select()
        .from(schema.pendingEntries)
        .where(
          and(
            eq(schema.pendingEntries.firmId, firmId),
            eq(schema.pendingEntries.scheduleId, schedule.id),
          ),
        );
      assert.deepEqual(drafts.map((d) => d.date).sort(), [
        addDays(today, -1),
        today,
      ]);
      const after = await ok<{
        generatedCount: number;
        nextDate: string;
        lastSkippedOn: string;
        version: number;
      }>(owner, "GET", `/v1/recurring/${schedule.id}`);
      assert.equal(after.generatedCount, 3);
      assert.equal(after.nextDate, addDays(today, 1));
      assert.equal(after.lastSkippedOn, twoBack);
      await db
        .update(schema.bookControls)
        .set({ closedThrough: null })
        .where(eq(schema.bookControls.firmId, firmId));

      // Drafts are not in the books.
      assert.equal(await payments(), 1);
      let list = await ok<EntryList>(owner, "GET", "/v1/entries");
      assert.equal(list.counts.drafts, 2);
      const notices = await ok<{ notices: { kind: string; title: string }[] }>(
        owner,
        "GET",
        "/v1/notifications",
      );
      assert.ok(
        notices.notices.some(
          (n) => n.kind === "entries" && /2 recurring entries/.test(n.title),
        ),
      );
      assert.ok(
        notices.notices.some(
          (n) => n.kind === "entries" && /skipped/.test(n.title),
        ),
      );

      // Edit and save a draft: it posts with the normal rules, numbered now.
      const [first, second] = list.entries;
      assert.ok(first && second);
      const edited = await ok<Entry>(
        owner,
        "PUT",
        `/v1/entries/${first.id}`,
        { input: { ...first.input, amount: 60_000 } },
        first.version,
      );
      const stale = await call(
        owner,
        "POST",
        `/v1/entries/${first.id}/save`,
        {},
        first.version,
      );
      assert.equal(stale.statusCode, 409, stale.body);
      const saved = await ok<{
        entry: Entry;
        voucher: { id: string; amount: number; number: string };
      }>(owner, "POST", `/v1/entries/${first.id}/save`, {}, edited.version);
      assert.equal(saved.entry.status, "posted");
      assert.equal(saved.voucher.amount, 60_000);
      assert.notEqual(saved.voucher.number, rent.number);
      assert.equal(await payments(), 2);
      const [log] = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.firmId, firmId),
            eq(schema.auditLog.voucherId, saved.voucher.id),
          ),
        );
      assert.equal(log?.note, "Made from a recurring schedule");
      const again = await call(
        owner,
        "POST",
        `/v1/entries/${first.id}/save`,
        {},
        saved.entry.version,
      );
      assert.equal(again.statusCode, 409, again.body);
      await ok(
        owner,
        "POST",
        `/v1/entries/${second.id}/discard`,
        undefined,
        second.version,
      );
      list = await ok<EntryList>(owner, "GET", "/v1/entries");
      assert.equal(list.counts.drafts, 0);
      assert.equal(await payments(), 2);

      // Pause, then delete the schedule.
      const paused = await ok<{ active: boolean; version: number }>(
        owner,
        "PUT",
        `/v1/recurring/${schedule.id}`,
        {
          name: "Daily rent",
          frequency: "daily",
          interval: 1,
          startDate: twoBack,
          active: false,
        },
        after.version,
      );
      assert.equal(paused.active, false);
      await ok(
        owner,
        "DELETE",
        `/v1/recurring/${schedule.id}`,
        undefined,
        paused.version,
      );
      assert.equal(
        (await ok<unknown[]>(owner, "GET", "/v1/recurring")).length,
        0,
      );

      // ---- T06: approvals ----------------------------------------------------
      const approvals = await ok<{ types: string[]; version: number }>(
        owner,
        "GET",
        "/v1/settings/approvals",
      );
      assert.deepEqual(approvals.types, []);
      // Off by default: the accountant posts directly.
      await ok(clerk, "POST", "/v1/payments", payment(1_000));
      assert.equal(await payments(), 3);
      const notOwner = await call(
        clerk,
        "PUT",
        "/v1/settings/approvals",
        { types: ["payment"] },
        approvals.version,
      );
      assert.equal(notOwner.statusCode, 403, notOwner.body);
      const salesNever = await call(
        owner,
        "PUT",
        "/v1/settings/approvals",
        { types: ["sale"] },
        approvals.version,
      );
      assert.equal(salesNever.statusCode, 400, salesNever.body);
      await ok(
        owner,
        "PUT",
        "/v1/settings/approvals",
        { types: ["payment"] },
        approvals.version,
      );
      const direct = await call(clerk, "POST", "/v1/payments", payment(2_000));
      assert.equal(direct.statusCode, 409, direct.body);
      assert.equal(direct.json().error.code, "APPROVAL_REQUIRED");
      // Receipts are not turned on: nothing to send for approval.
      const notNeeded = await call(clerk, "POST", "/v1/entries", {
        voucherType: "receipt",
        input: payment(100),
      });
      assert.equal(notNeeded.statusCode, 409, notNeeded.body);

      const submitted = await ok<Entry>(clerk, "POST", "/v1/entries", {
        voucherType: "payment",
        input: payment(2_000),
      });
      assert.equal(submitted.status, "submitted");
      assert.equal(await payments(), 3);
      const selfApprove = await call(
        clerk,
        "POST",
        `/v1/entries/${submitted.id}/approve`,
        {},
        submitted.version,
      );
      assert.equal(selfApprove.statusCode, 403, selfApprove.body);
      list = await ok<EntryList>(owner, "GET", "/v1/entries");
      assert.equal(list.counts.submitted, 1);
      assert.equal(list.canApprove, true);
      const ownerNotices = await ok<{ notices: { title: string }[] }>(
        owner,
        "GET",
        "/v1/notifications",
      );
      assert.ok(
        ownerNotices.notices.some((n) => /waits for approval/.test(n.title)),
      );

      // Sent back with a reason, fixed and sent again by the accountant.
      const rejected = await ok<Entry>(
        owner,
        "POST",
        `/v1/entries/${submitted.id}/reject`,
        { reason: "Wrong amount" },
        submitted.version,
      );
      assert.equal(rejected.status, "rejected");
      const clerkList = await ok<EntryList>(clerk, "GET", "/v1/entries");
      assert.equal(clerkList.counts.rejected, 1);
      assert.equal(clerkList.entries[0]?.rejectReason, "Wrong amount");
      assert.equal(clerkList.canApprove, false);
      const resent = await ok<{ entry: Entry; voucher?: unknown }>(
        clerk,
        "POST",
        `/v1/entries/${submitted.id}/save`,
        { input: payment(2_500) },
        rejected.version,
      );
      assert.equal(resent.entry.status, "submitted");
      assert.equal(resent.voucher, undefined);
      assert.equal(await payments(), 3);

      // The owner's own payment posts directly; approval numbers the entry then.
      const own = await ok<{ number: string }>(
        owner,
        "POST",
        "/v1/payments",
        payment(3_000),
      );
      const approved = await ok<{
        entry: Entry;
        voucher: { id: string; amount: number; number: string };
      }>(
        owner,
        "POST",
        `/v1/entries/${submitted.id}/approve`,
        {},
        resent.entry.version,
      );
      assert.equal(approved.entry.status, "posted");
      assert.equal(approved.voucher.amount, 2_500);
      assert.notEqual(approved.voucher.number, own.number);
      assert.deepEqual(
        approved.entry.history.map((h) => h.action),
        ["submitted", "rejected", "submitted", "approved"],
      );
      assert.equal(await payments(), 5);
      const [approvedLog] = await db
        .select()
        .from(schema.auditLog)
        .where(
          and(
            eq(schema.auditLog.firmId, firmId),
            eq(schema.auditLog.voucherId, approved.voucher.id),
          ),
        );
      assert.match(approvedLog?.note ?? "", /approved by Rec owner/);
      const twice = await call(
        owner,
        "POST",
        `/v1/entries/${submitted.id}/approve`,
        {},
        approved.entry.version,
      );
      assert.equal(twice.statusCode, 409, twice.body);

      // A recurring payment draft saved by the accountant goes for approval.
      const weekly = await ok<{ id: string }>(owner, "POST", "/v1/recurring", {
        name: "Weekly cleaning",
        voucherType: "payment",
        frequency: "weekly",
        startDate: today,
        template: payment(700),
      });
      await runRecurring(db, now);
      const draft = (
        await ok<EntryList>(clerk, "GET", "/v1/entries")
      ).entries.find((e) => e.status === "draft");
      assert.ok(draft);
      const viaDraft = await ok<{ entry: Entry }>(
        clerk,
        "POST",
        `/v1/entries/${draft.id}/save`,
        {},
        draft.version,
      );
      assert.equal(viaDraft.entry.status, "submitted");
      assert.equal(await payments(), 5);
      assert.ok(weekly.id);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
