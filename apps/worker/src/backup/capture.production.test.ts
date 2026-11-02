import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { v7 as requestId } from "uuid";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, schema } from "@repo/backend/db/client";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import {
  blankBooks,
  finalAccounts,
  partyBalance,
  today,
  trialBalance,
} from "@repo/core";
import { insertFirm } from "../../../api/src/db/seedFirm";
import { vouchersService } from "../../../api/src/modules/vouchers/vouchers.service";
import { sourceFacts } from "./state";

const databaseUrl = process.env.CAPTURE_DATABASE_URL;
const image = process.env.CAPTURE_WORKER_IMAGE;

function docker(args: string[], input = "") {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      "docker",
      args,
      { timeout: 90_000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `Fixture container failed: ${stderr.slice(0, 4096) || stdout.slice(0, 4096)}`,
            ),
          );
        else resolve(stdout);
      },
    );
    child.stdin?.end(input);
  });
}

async function seedDatabase(database: ReturnType<typeof createDb>) {
  const ownerId = randomUUID();
  await database.db.insert(schema.user).values({
    id: ownerId,
    name: "Recovery fixture",
    email: `${ownerId}@example.invalid`,
    emailVerified: true,
  });
  await database.db.insert(schema.account).values({
    userId: ownerId,
    accountId: ownerId,
    providerId: "credential",
    password: "synthetic-fixture-password-hash",
  });
  const books = blankBooks({
    id: "capture",
    name: "Recovery fixture",
    city: "Mathura",
    stateCode: "09",
    gstRegistration: "unregistered",
  });
  books.parties = [
    {
      id: "customer",
      name: "Fixture customer",
      type: "customer",
      phone: "",
      city: "Mathura",
      stateCode: "09",
      creditDays: 0,
      creditLimit: 0,
      openingBalance: 0,
      openingDate: books.firm.fyStart,
    },
  ];
  books.items = [
    {
      id: "item",
      name: "Fixture item",
      code: "",
      hsn: "",
      group: "",
      taxType: "nongst",
      gstRate: 0,
      unit: "Nos",
      purchasePrice: 10000,
      salePrice: 15000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 10,
      openingCost: 10000,
      openingBookScope: "nongst",
    },
  ];
  const firmId = await insertFirm(database.db, books, ownerId);
  const [party] = await database.db
    .select()
    .from(schema.parties)
    .where(eq(schema.parties.firmId, firmId));
  const [item] = await database.db
    .select()
    .from(schema.items)
    .where(eq(schema.items.firmId, firmId));
  const [cash] = await database.db
    .select()
    .from(schema.ledgers)
    .where(eq(schema.ledgers.firmId, firmId));
  const key = requestId();
  const actor = {
    id: ownerId,
    name: "Recovery fixture",
    firmId,
    role: "owner" as const,
  };
  const sale = await vouchersService.sale(
    database.db,
    { ...actor, idem: { key, hash: "synthetic-durable-answer" } },
    {
      partyId: party.id,
      date: today(),
      charges: [],
      lines: [
        {
          itemId: item.id,
          stockLotId: `opening:${item.id}`,
          qty: 1,
          rate: 15000,
          gstRate: 0,
        },
      ],
    },
  );
  await vouchersService.receipt(database.db, actor, {
    partyId: party.id,
    date: today(),
    amount: 15000,
    mode: "cash",
    ledgerId: cash.id,
    allocations: [{ voucherId: sale.id, amount: 15000 }],
    bookScope: "nongst",
  });
  return { ownerId, firmId, key, sale };
}

async function financialState(
  database: ReturnType<typeof createDb>,
  firmId: string,
) {
  const books = await loadReportBooks(database.db, firmId);
  return {
    trial: trialBalance(books),
    final: finalAccounts(books),
    party: partyBalance(books.parties[0], books.vouchers),
  };
}

async function tableCounts(client: pg.Client) {
  const tables = (
    await client.query(
      "select schemaname, tablename from pg_tables where schemaname in ('public', 'drizzle') order by schemaname, tablename",
    )
  ).rows;
  const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const result: Record<string, string> = {};
  for (const row of tables) {
    const schemaName = row.schemaname as string,
      tableName = row.tablename as string;
    result[`${schemaName}.${tableName}`] = (
      await client.query(
        `select count(*)::text as count from ${quoted(schemaName)}.${quoted(tableName)}`,
      )
    ).rows[0].count as string;
  }
  return result;
}

test(
  "production worker captures, restores and cancels a real PostgreSQL 17 backup",
  { skip: !databaseUrl || !image, timeout: 240_000 },
  async () => {
    assert.ok(databaseUrl);
    assert.ok(image);
    const base = new URL(databaseUrl);
    assert.equal(base.hostname, "127.0.0.1");
    assert.match(base.pathname, /^\/hardening_[a-z_]+$/);
    const connection = (name: string) => {
      const url = new URL(base);
      url.pathname = name;
      return url.toString();
    };
    const admin = new pg.Client({ connectionString: connection("postgres") });
    await admin.connect();
    const made: string[] = [];
    let source: ReturnType<typeof createDb> | undefined,
      target: ReturnType<typeof createDb> | undefined;
    let snapshotClient: pg.Client | undefined,
      targetClient: pg.Client | undefined,
      blocker: pg.Client | undefined;
    let root: string | undefined;
    try {
      for (const name of ["hardening_capture", "hardening_restored"]) {
        assert.equal(
          (
            await admin.query("select 1 from pg_database where datname=$1", [
              name,
            ])
          ).rowCount,
          0,
          "Refuse to reuse an existing fixture database",
        );
        await admin.query(`create database ${name} template template0`);
        made.push(name);
      }
      source = createDb(connection("hardening_capture"), { max: 2 });
      target = createDb(connection("hardening_restored"), { max: 2 });
      await migrate(source.db, {
        migrationsFolder: resolve(
          import.meta.dirname,
          "../../../api/src/db/migrations",
        ),
      });
      const seeded = await seedDatabase(source);
      const originalFinancial = await financialState(source, seeded.firmId);
      assert.equal(originalFinancial.party, 0);
      assert.equal(originalFinancial.final.profitAndLoss.netProfit, 5000);
      assert.equal(originalFinancial.final.profitAndLoss.closingStock, 90000);
      assert.equal(originalFinancial.trial.totalDebit, 115000);
      assert.equal(originalFinancial.trial.totalCredit, 115000);
      const cash = originalFinancial.trial.rows.find(
        (row) => row.group === "Cash-in-hand",
      );
      assert.ok(cash);
      assert.equal(cash.debit, 15000);
      assert.equal(cash.credit, 0);
      snapshotClient = new pg.Client({
        connectionString: connection("hardening_capture"),
      });
      await snapshotClient.connect();
      await snapshotClient.query(
        "begin isolation level repeatable read read only",
      );
      const snapshot = (
        await snapshotClient.query("select pg_export_snapshot() as snapshot")
      ).rows[0].snapshot as string;
      const facts = await sourceFacts(snapshotClient);
      const counts = await tableCounts(snapshotClient);
      assert.equal(facts.counts.users, 1);
      assert.equal(facts.counts.vouchers, 2);
      assert.equal(counts["public.operation_receipts"], "1");
      // A later commit must be absent from a dump importing the already exported snapshot.
      await source.db.insert(schema.user).values({
        name: "After snapshot",
        email: `${randomUUID()}@example.invalid`,
      });
      root = await mkdtemp(join(tmpdir(), "hisaab-capture-production-"));
      const inside = new URL(connection("hardening_capture"));
      inside.port = "5432";
      const envFile = join(root, "fixture.env");
      await writeFile(
        envFile,
        `CAPTURE_DATABASE_URL=${inside}\nCAPTURE_SNAPSHOT=${snapshot}\nPGHOST=127.0.0.1\nPGPORT=5432\nPGUSER=${decodeURIComponent(base.username)}\nPGPASSWORD=${decodeURIComponent(base.password)}\n`,
        { mode: 0o600 },
      );
      const run = async (args: string[], code = "") => {
        const name = `hisaab-capture-${randomUUID().slice(0, 8)}`;
        try {
          const currentSource =
            process.env.CAPTURE_USE_CURRENT_SOURCE === "true"
              ? [
                  "--mount",
                  `type=bind,source=${join(import.meta.dirname, "capture.ts")},target=/app/apps/worker/src/backup/capture.ts,readonly`,
                ]
              : [];
          return await docker(
            [
              "run",
              "--rm",
              "--init",
              "-i",
              "--name",
              name,
              "--network",
              "container:hisaab-hardening-20261026-pg",
              "--env-file",
              envFile,
              "--mount",
              `type=bind,source=${root},target=/capture-output`,
              ...currentSource,
              image,
              ...args,
            ],
            code,
          );
        } finally {
          await docker(["rm", "--force", name]).catch(() => undefined);
        }
      };
      const captureScript = `
      import assert from 'node:assert/strict';
      import { copyFile, stat, writeFile } from 'node:fs/promises';
      import { dirname } from 'node:path';
      import { captureDatabase } from './src/backup/capture.ts';
      const result = await captureDatabase({databaseUrl:process.env.CAPTURE_DATABASE_URL,snapshot:process.env.CAPTURE_SNAPSHOT,signal:new AbortController().signal});
      try {
        assert.equal((await stat(dirname(result.path))).mode & 511, 448);
        assert.equal((await stat(result.path)).mode & 511, 384);
        await copyFile(result.path, '/capture-output/database.dump');
        await writeFile('/capture-output/result.json', JSON.stringify({bytes:result.bytes,sha256:result.sha256,md5:result.md5,clientVersion:result.clientVersion}), {mode:384});
      } finally { await result.dispose(); }
    `;
      await run(
        ["node", "--import", "tsx", "--input-type=module"],
        captureScript,
      );
      const captured = JSON.parse(
        await readFile(join(root, "result.json"), "utf8"),
      ) as { clientVersion: string; bytes: number };
      assert.match(captured.clientVersion, /^17\./);
      assert.ok(captured.bytes > 0);
      await snapshotClient.query("rollback");
      await run([
        "pg_restore",
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname=hardening_restored",
        "/capture-output/database.dump",
      ]);
      targetClient = new pg.Client({
        connectionString: connection("hardening_restored"),
      });
      await targetClient.connect();
      assert.deepEqual(await tableCounts(targetClient), counts);
      const restoredFacts = await sourceFacts(targetClient);
      assert.deepEqual(restoredFacts.counts, facts.counts);
      assert.equal(restoredFacts.migrationHash, facts.migrationHash);
      assert.equal(restoredFacts.migrationCount, facts.migrationCount);
      assert.deepEqual(
        await financialState(target, seeded.firmId),
        originalFinancial,
      );
      const totals = (
        await targetClient.query(
          "select sum(debit)::text as debit, sum(credit)::text as credit from postings",
        )
      ).rows[0];
      assert.deepEqual(totals, { debit: "30000", credit: "30000" });
      const receipt = (
        await targetClient.query(
          "select request_hash, result from operation_receipts where key=$1",
          [seeded.key],
        )
      ).rows[0];
      assert.equal(receipt.request_hash, "synthetic-durable-answer");
      assert.deepEqual(receipt.result, {
        state: "committed",
        response: JSON.parse(JSON.stringify(seeded.sale)),
      });
      const failureScript = (code: string, timeout?: number) => `
      import assert from 'node:assert/strict';
      import { readdir } from 'node:fs/promises';
      import { captureDatabase } from './src/backup/capture.ts';
      const before=(await readdir('/tmp')).filter(name=>name.startsWith('hisaab-pg-backup-'));
      const controller=new AbortController();
      ${timeout ? `setTimeout(()=>controller.abort(), ${timeout});` : ""}
      await assert.rejects(captureDatabase({databaseUrl:process.env.CAPTURE_DATABASE_URL,snapshot:process.env.CAPTURE_SNAPSHOT,signal:controller.signal}), {code:${JSON.stringify(code)}});
      assert.deepEqual((await readdir('/tmp')).filter(name=>name.startsWith('hisaab-pg-backup-')),before);
    `;
      await run(
        ["node", "--import", "tsx", "--input-type=module"],
        failureScript("BACKUP_CLIENT_FAILED"),
      );
      await snapshotClient.query(
        "begin isolation level repeatable read read only",
      );
      const next = (
        await snapshotClient.query("select pg_export_snapshot() as snapshot")
      ).rows[0].snapshot as string;
      await writeFile(
        envFile,
        (await readFile(envFile, "utf8")).replace(snapshot, next),
        { mode: 0o600 },
      );
      blocker = new pg.Client({
        connectionString: connection("hardening_capture"),
      });
      await blocker.connect();
      await blocker.query("begin");
      await blocker.query("lock table postings in access exclusive mode");
      await run(
        ["node", "--import", "tsx", "--input-type=module"],
        failureScript("BACKUP_CAPTURE_ABORTED", 500),
      );
      await blocker.query("rollback");
      assert.equal(
        (
          await admin.query(
            "select count(*)::int as count from pg_stat_activity where datname='hardening_capture' and application_name='pg_dump'",
          )
        ).rows[0].count,
        0,
      );
    } finally {
      await blocker?.end();
      await snapshotClient?.end();
      await targetClient?.end();
      await source?.pool.end();
      await target?.pool.end();
      for (const name of made.reverse())
        await admin.query(`drop database ${name}`);
      await admin.end();
      if (root) await rm(root, { recursive: true, force: true });
    }
  },
);
