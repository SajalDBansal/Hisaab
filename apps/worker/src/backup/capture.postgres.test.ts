import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import pg from "pg";
import { createDatabaseCapture } from "./capture";

const databaseUrl = process.env.CAPTURE_DATABASE_URL;

test(
  "PostgreSQL 17 captures a real exported snapshot with migration and retry data",
  { skip: !databaseUrl, timeout: 60_000 },
  async () => {
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.equal(url.hostname, "127.0.0.1");
    assert.match(url.pathname, /^\/hardening_[a-z_]+$/);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    let captured:
      Awaited<ReturnType<ReturnType<typeof createDatabaseCapture>>> | undefined;
    let diagnostic = "";
    try {
      await client.query("begin isolation level repeatable read read only");
      const snapshot = (
        await client.query("select pg_export_snapshot() as snapshot")
      ).rows[0].snapshot as string;
      const container =
        process.env.CAPTURE_POSTGRES_CONTAINER ??
        "hisaab-hardening-20261026-pg";
      // Only the fixture adapter uses Docker; production invokes installed pg clients directly.
      const capture = createDatabaseCapture({
        start(command, args, env) {
          const list = command === "pg_restore" && args[0] === "--list";
          const child = spawn(
            "docker",
            [
              "exec",
              "-i",
              container,
              "sh",
              "-c",
              'IFS= read -r PGDATABASE; IFS= read -r PGUSER; IFS= read -r PGPASSWORD; export PGDATABASE PGUSER PGPASSWORD; export PGHOST=127.0.0.1 PGPORT=5432 PGCONNECT_TIMEOUT=10; exec "$@"',
              "capture-fixture",
              command,
              ...(list ? ["--list"] : args),
            ],
            {
              env: process.env,
              shell: false,
              windowsHide: true,
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          // The fixture's Docker transport uses stdin so credentials never appear in argv.
          child.stdin.write(
            `${env.PGDATABASE}\n${env.PGUSER}\n${env.PGPASSWORD}\n`,
          );
          child.stderr.on("data", (chunk: Buffer) => {
            if (diagnostic.length < 4096)
              diagnostic += chunk.toString().slice(0, 4096 - diagnostic.length);
          });
          if (list) {
            const file = createReadStream(args[1]);
            file.on("error", () => child.kill());
            child.once("close", () => file.destroy());
            file.pipe(child.stdin);
          } else child.stdin.end();
          return child;
        },
      });
      captured = await capture({
        databaseUrl,
        snapshot,
        signal: new AbortController().signal,
      });
      assert.ok(captured.bytes > 0);
      assert.equal((await stat(captured.path)).size, captured.bytes);
      assert.match(captured.clientVersion, /^17\./);
      const file = await open(captured.path, "r");
      try {
        const header = Buffer.alloc(5);
        await file.read(header, 0, header.length, 0);
        assert.equal(header.toString(), "PGDMP");
      } finally {
        await file.close();
      }
    } catch (error) {
      const safe = diagnostic
        .replaceAll(decodeURIComponent(url.password), "[fixture-secret]")
        .replace(/postgres(?:ql)?:\/\/\S+/g, "[connection]");
      throw new Error(`Fixture capture failed: ${safe}`, { cause: error });
    } finally {
      await captured?.dispose();
      await client.query("rollback");
      await client.end();
    }
  },
);
