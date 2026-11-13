import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "bun:sqlite";
import { createReplica, setReplicaBooks, replicaChecksum } from "@repo/core";
import { sqlReplicaStore } from "../src/replica/sqlStore.ts";

/** bun:sqlite behind the few expo-sqlite methods the store uses. */
function bunConnection(db) {
  const conn = {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, ...params) {
      return db.query(source).run(...params);
    },
    async getAllAsync(source, ...params) {
      return db.query(source).all(...params);
    },
    async withExclusiveTransactionAsync(task) {
      db.exec("BEGIN EXCLUSIVE");
      try {
        await task(conn);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return conn;
}

const tables = {
  firm: {
    id: "f",
    name: "F",
    city: "",
    state: "",
    stateCode: "09",
    gstin: "",
    gstRegistration: "unregistered",
    fyStart: "2026-04-01",
  },
  accounts: [],
  ledgers: [{ id: "cash", name: "Cash", kind: "cash", openingBalance: 0 }],
  openingAccounts: [],
  invoiceSettings: {
    template: "simple",
    terms: "",
    showBankDetails: false,
    bankLedgerId: "",
    prefixes: {},
    billOfSupplyPrefix: "BS",
  },
  units: [],
  reminders: {
    enabled: false,
    daysBefore: 3,
    onDueDate: true,
    repeatEvery: 7,
    minAmount: 0,
  },
};
const party = (id, name) => ({
  id,
  name,
  type: "customer",
  phone: "",
  city: "",
  stateCode: "09",
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
});

/** A tiny server: rows by id, a change log, and the head with its checksum. */
function fakeServer() {
  const parties = new Map([
    ["p1", party("p1", "Asha")],
    ["p2", party("p2", "Bina")],
  ]);
  const log = [];
  let seq = 0;
  return {
    parties,
    change(id, row) {
      if (row) parties.set(id, row);
      else parties.delete(id);
      log.push({ seq: ++seq, id });
    },
    async get(path) {
      const url = new URL(path, "http://x");
      if (url.pathname === "/v1/replica/head")
        return {
          seq,
          tables,
          counts: { parties: parties.size, items: 0, vouchers: 0 },
          checksum: {
            parties: replicaChecksum(parties.values()),
            items: 0,
            vouchers: 0,
          },
        };
      if (url.pathname === "/v1/replica/rows")
        return {
          rows:
            url.searchParams.get("kind") === "parties"
              ? [...parties.values()]
              : [],
          next: null,
        };
      if (url.pathname === "/v1/replica/changes") {
        const since = Number(url.searchParams.get("since"));
        const ids = [
          ...new Set(log.filter((l) => l.seq > since).map((l) => l.id)),
        ];
        return {
          seq,
          reset: false,
          more: false,
          tables,
          changes: {
            parties: {
              upsert: ids
                .filter((id) => parties.has(id))
                .map((id) => parties.get(id)),
              remove: ids.filter((id) => !parties.has(id)),
            },
            items: { upsert: [], remove: [] },
            vouchers: { upsert: [], remove: [] },
          },
        };
      }
      throw new Error("unexpected " + path);
    },
  };
}

test("the phone keeps the books in SQLite and syncs only what changed", async () => {
  const file = new Database(":memory:");
  const store = sqlReplicaStore(async () => bunConnection(file));
  const server = fakeServer();
  const states = [];
  const phone = createReplica({
    firmId: "f",
    storeKey: "u:f",
    store,
    get: server.get,
    onState: (s) => states.push(s.phase),
  });
  assert.equal(await phone.open(), false);
  await phone.sync();
  assert.ok(states.includes("downloading"));
  assert.deepEqual(
    phone
      .books()
      .parties.map((p) => p.name)
      .sort(),
    ["Asha", "Bina"],
  );

  server.change("p1", { ...party("p1", "Asha Rani") });
  server.change("p2", null);
  server.change("p3", party("p3", "Chand"));
  await phone.sync();
  assert.deepEqual(
    phone
      .books()
      .parties.map((p) => p.name)
      .sort(),
    ["Asha Rani", "Chand"],
  );

  // A restart reads SQLite: same books, no download.
  const reopened = createReplica({
    firmId: "f",
    storeKey: "u:f",
    store,
    get: async () => assert.fail("no network needed"),
  });
  assert.equal(await reopened.open(), true);
  assert.deepEqual(
    reopened
      .books()
      .parties.map((p) => p.name)
      .sort(),
    ["Asha Rani", "Chand"],
  );
  assert.equal(
    file
      .query("SELECT count(*) AS n FROM replica_rows WHERE owner = 'u:f'")
      .get().n,
    2,
  );
});

test("a failed write leaves the saved books and cursor as they were", async () => {
  const file = new Database(":memory:");
  const store = sqlReplicaStore(async () => bunConnection(file));
  const meta = { schema: 1, firmId: "f", seq: 1, tables, syncedAt: "t" };
  await store.write("u:f", {
    meta,
    upserts: [{ kind: "parties", id: "p1", json: '{"id":"p1"}' }],
    removes: [],
  });
  // The second row breaks a NOT NULL rule mid-transaction.
  await assert.rejects(
    store.write("u:f", {
      meta: { ...meta, seq: 2 },
      upserts: [
        { kind: "parties", id: "p2", json: '{"id":"p2"}' },
        { kind: "parties", id: "p3", json: null },
      ],
      removes: [],
    }),
  );
  const saved = await store.read("u:f");
  assert.equal(saved.meta.seq, 1);
  assert.deepEqual(
    saved.rows.map((r) => r.json),
    ['{"id":"p1"}'],
  );
  await store.clear();
  assert.equal((await store.read("u:f")).meta, null);
});

test("offline, reads come from the phone's books and every save is refused", async () => {
  const { localServices } = await import("../src/replica/localServices.ts");
  const server = fakeServer();
  const phone = createReplica({
    firmId: "f",
    store: sqlReplicaStore(async () => bunConnection(new Database(":memory:"))),
    get: server.get,
  });
  await phone.sync();
  setReplicaBooks(phone.books());
  try {
    const services = localServices("owner");
    const firm = await services.firmService.getCurrent();
    assert.equal(firm.role, "owner");
    assert.ok(firm.permissions.includes("reports"));
    const rows = await services.partyService.list("customer");
    assert.deepEqual(rows.map((r) => r.party.name).sort(), ["Asha", "Bina"]);
    await assert.rejects(
      services.partyService.create({ name: "X" }),
      /need to be online/,
    );
    await assert.rejects(
      services.voucherService.createSale({}),
      /need to be online/,
    );
    await assert.rejects(
      services.voucherService.cancel("v", "r"),
      /need to be online/,
    );
    await assert.rejects(
      services.bookControlService.get(),
      /needs a connection/,
    );
  } finally {
    setReplicaBooks(null);
  }
});
