// The books on the phone: a read-only copy of the firm's books, kept in step
// with the server. Saves always go to the server first; the copy changes only
// from what the server committed, so it can never disagree with the books.
//
//   first open on a phone   head (cursor S0) -> every row in pages -> changes since S0
//   every sync              changes since the cursor, applied in one transaction
//   now and then            compare a checksum of every row with the server's;
//                           a mismatch downloads the books again
//
// Offline, every screen is computed from this copy by the same core functions
// the server uses, so the numbers are the same.

import type { Db as MockDb } from "./mock/db";
import type { Item, Party, Voucher } from "./types";

export type ReplicaKind = "parties" | "items" | "vouchers";
export const REPLICA_KINDS: ReplicaKind[] = ["parties", "items", "vouchers"];

/** The small tables, sent whole with every sync. */
export type ReplicaTables = Pick<
  MockDb,
  | "firm"
  | "accounts"
  | "ledgers"
  | "openingAccounts"
  | "invoiceSettings"
  | "units"
  | "reminders"
>;

export type ReplicaChecksum = Record<ReplicaKind, number>;

/** GET /v1/replica/head */
export interface ReplicaHead {
  /** Change-log cursor at the moment these answers were read. */
  seq: number;
  tables: ReplicaTables;
  counts: Record<ReplicaKind, number>;
  checksum: ReplicaChecksum;
}

/** GET /v1/replica/rows?kind&after&limit */
export interface ReplicaRows {
  rows: unknown[];
  /** Pass as `after` for the next page; null on the last. */
  next: string | null;
}

/** GET /v1/replica/changes?since */
export interface ReplicaChanges {
  seq: number;
  /** Too much changed: download the books again. */
  reset: boolean;
  /** More changes wait after `seq`. */
  more: boolean;
  tables: ReplicaTables;
  changes: Record<ReplicaKind, { upsert: unknown[]; remove: string[] }>;
}

// ---- Checksum ----------------------------------------------------------------

/** FNV-1a, 32-bit, over a row's JSON. */
function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Order-free checksum of a table: the sum of each row's hash. */
export function replicaChecksum(rows: Iterable<unknown>): number {
  let sum = 0;
  for (const row of rows) sum = (sum + fnv(JSON.stringify(row))) >>> 0;
  return sum;
}

/** A voucher as the phone keeps it: without the frozen print copy. */
export function replicaVoucher(voucher: Voucher): Voucher {
  const { snapshot: _print, ...rest } = voucher;
  return rest;
}

// ---- Assembling the books -------------------------------------------------------

const voucherOrder = (a: Voucher, b: Voucher) =>
  a.date < b.date
    ? -1
    : a.date > b.date
      ? 1
      : a.createdAt < b.createdAt
        ? -1
        : a.createdAt > b.createdAt
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;

/** The books the core functions read, in the server's voucher order. */
export function assembleBooks(
  tables: ReplicaTables,
  parties: Iterable<Party>,
  items: Iterable<Item>,
  vouchers: Iterable<Voucher>,
): MockDb {
  return {
    ...tables,
    parties: [...parties],
    items: [...items],
    vouchers: [...vouchers].sort(voucherOrder),
    counters: {},
    team: [],
    currentUserId: "",
    documents: [],
    remindedOn: {},
    readNotices: [],
    auditLog: [],
  } as MockDb;
}

// ---- Storage ------------------------------------------------------------------

export interface ReplicaMeta {
  schema: 1;
  firmId: string;
  seq: number;
  tables: ReplicaTables;
  syncedAt: string;
  /** The cursor at which the checksum last matched the server's. */
  verifiedSeq?: number;
}

/** Where the copy lives: SQLite on phones, an encrypted store on the web, memory in tests. */
export interface ReplicaStore {
  read(firmId: string): Promise<{
    meta: ReplicaMeta | null;
    rows: { kind: ReplicaKind; json: string }[];
  }>;
  /** One atomic write: every row and the new cursor, or nothing. */
  write(
    firmId: string,
    batch: {
      meta: ReplicaMeta;
      reset?: boolean;
      upserts: { kind: ReplicaKind; id: string; json: string }[];
      removes: { kind: ReplicaKind; id: string }[];
    },
  ): Promise<void>;
  /** Forget one firm, or every firm (sign-out). */
  clear(firmId?: string): Promise<void>;
}

/** For tests and as a fallback: nothing survives a restart. */
export function memoryReplicaStore(): ReplicaStore {
  const firms = new Map<
    string,
    {
      meta: ReplicaMeta | null;
      rows: Map<string, { kind: ReplicaKind; json: string }>;
    }
  >();
  const firm = (id: string) => {
    let entry = firms.get(id);
    if (!entry) firms.set(id, (entry = { meta: null, rows: new Map() }));
    return entry;
  };
  return {
    async read(firmId) {
      const entry = firm(firmId);
      return { meta: entry.meta, rows: [...entry.rows.values()] };
    },
    async write(firmId, batch) {
      const entry = firm(firmId);
      if (batch.reset) entry.rows.clear();
      for (const r of batch.upserts) entry.rows.set(`${r.kind}:${r.id}`, r);
      for (const r of batch.removes) entry.rows.delete(`${r.kind}:${r.id}`);
      entry.meta = batch.meta;
    },
    async clear(firmId) {
      if (firmId) firms.delete(firmId);
      else firms.clear();
    },
  };
}

// ---- Sync -----------------------------------------------------------------------

export type ReplicaPhase =
  "empty" | "loading" | "downloading" | "syncing" | "ready" | "error";

export interface ReplicaState {
  phase: ReplicaPhase;
  /** First download: 0..1. */
  progress: number;
  /** Parties, items and vouchers on the phone. */
  rows: number;
  /** When the copy last matched the server. */
  syncedAt?: string;
  error?: string;
  /** The copy can answer screens. */
  ready: boolean;
}

const PAGE = 500;
/** Check the whole copy against the server once per this many syncs. */
const VERIFY_EVERY = 20;

/**
 * Keeps one firm's copy in step. `get` reads an API path as the signed-in
 * user (the server checks the firm and role). Syncs never overlap: a sync
 * asked for while one runs makes exactly one more run afterwards.
 */
export function createReplica(options: {
  firmId: string;
  /** Where the copy is kept in the store; per user and firm on a shared phone. */
  storeKey?: string;
  store: ReplicaStore;
  get: (path: string) => Promise<unknown>;
  onState?: (state: ReplicaState) => void;
  now?: () => Date;
}) {
  const { firmId, store, get } = options;
  const storeKey = options.storeKey ?? firmId;
  const now = options.now ?? (() => new Date());
  const rows: Record<ReplicaKind, Map<string, unknown>> = {
    parties: new Map(),
    items: new Map(),
    vouchers: new Map(),
  };
  let meta: ReplicaMeta | null = null;
  let books: MockDb | null = null;
  let state: ReplicaState = {
    phase: "empty",
    progress: 0,
    rows: 0,
    ready: false,
  };
  let running: Promise<void> | null = null;
  let again = false;
  let syncs = 0;

  const count = () => rows.parties.size + rows.items.size + rows.vouchers.size;
  const set = (patch: Partial<ReplicaState>) => {
    state = { ...state, ...patch, rows: count(), ready: !!meta };
    options.onState?.(state);
  };
  const idOf = (row: unknown) => (row as { id: string }).id;
  const metaWith = (seq: number, tables: ReplicaTables): ReplicaMeta => ({
    schema: 1,
    firmId,
    seq,
    tables,
    syncedAt: now().toISOString(),
    verifiedSeq: meta?.verifiedSeq,
  });

  async function open() {
    set({ phase: "loading" });
    const saved = await store.read(storeKey);
    for (const kind of REPLICA_KINDS) rows[kind].clear();
    for (const row of saved.rows) {
      const value = JSON.parse(row.json) as unknown;
      rows[row.kind].set(idOf(value), value);
    }
    meta = saved.meta?.schema === 1 ? saved.meta : null;
    books = null;
    set({ phase: meta ? "ready" : "empty", syncedAt: meta?.syncedAt });
    return !!meta;
  }

  async function download() {
    set({ phase: "downloading", progress: 0 });
    const head = (await get("/v1/replica/head")) as ReplicaHead;
    const total = Math.max(
      1,
      head.counts.parties + head.counts.items + head.counts.vouchers,
    );
    const fresh: Record<ReplicaKind, Map<string, unknown>> = {
      parties: new Map(),
      items: new Map(),
      vouchers: new Map(),
    };
    let loaded = 0;
    for (const kind of REPLICA_KINDS) {
      let after: string | null = null;
      do {
        const page = (await get(
          `/v1/replica/rows?kind=${kind}&limit=${PAGE}${after ? `&after=${after}` : ""}`,
        )) as ReplicaRows;
        for (const row of page.rows) fresh[kind].set(idOf(row), row);
        loaded += page.rows.length;
        set({ progress: Math.min(0.99, loaded / total) });
        after = page.next;
      } while (after);
    }
    const upserts = REPLICA_KINDS.flatMap((kind) =>
      [...fresh[kind]].map(([id, row]) => ({
        kind,
        id,
        json: JSON.stringify(row),
      })),
    );
    const next: ReplicaMeta = {
      ...metaWith(head.seq, head.tables),
      verifiedSeq: undefined,
    };
    await store.write(storeKey, {
      meta: next,
      reset: true,
      upserts,
      removes: [],
    });
    for (const kind of REPLICA_KINDS) rows[kind] = fresh[kind];
    meta = next;
    books = null;
    // Anything saved while the pages were read comes in as changes.
    await pull();
  }

  async function pull() {
    for (;;) {
      if (!meta) return download();
      const page = (await get(
        `/v1/replica/changes?since=${meta.seq}`,
      )) as ReplicaChanges;
      if (page.reset) {
        meta = null;
        return download();
      }
      const upserts: { kind: ReplicaKind; id: string; json: string }[] = [];
      const removes: { kind: ReplicaKind; id: string }[] = [];
      for (const kind of REPLICA_KINDS) {
        for (const row of page.changes[kind].upsert)
          upserts.push({ kind, id: idOf(row), json: JSON.stringify(row) });
        for (const id of page.changes[kind].remove) removes.push({ kind, id });
      }
      const next = metaWith(page.seq, page.tables);
      await store.write(storeKey, { meta: next, upserts, removes });
      for (const r of upserts) rows[r.kind].set(r.id, JSON.parse(r.json));
      for (const r of removes) rows[r.kind].delete(r.id);
      const changed =
        upserts.length > 0 ||
        removes.length > 0 ||
        JSON.stringify(meta.tables) !== JSON.stringify(page.tables);
      meta = next;
      if (changed) books = null;
      if (!page.more) return;
    }
  }

  /** Compare every row with the server; download again on a mismatch. */
  async function verify(retried = false): Promise<void> {
    let head = (await get("/v1/replica/head")) as ReplicaHead;
    if (!meta || head.seq !== meta.seq) {
      await pull();
      head = (await get("/v1/replica/head")) as ReplicaHead;
      // Still moving: try again on a later sync.
      if (!meta || head.seq !== meta.seq) return;
    }
    const matches = REPLICA_KINDS.every(
      (kind) => replicaChecksum(rows[kind].values()) === head.checksum[kind],
    );
    if (matches) {
      meta = { ...meta, verifiedSeq: meta.seq };
      await store.write(storeKey, { meta, upserts: [], removes: [] });
      return;
    }
    if (retried)
      throw new Error("The books on this phone don't match the server.");
    await store.clear(storeKey);
    meta = null;
    await download();
    return verify(true);
  }

  async function run() {
    try {
      if (!meta) await download();
      else {
        set({ phase: "syncing" });
        await pull();
      }
      if (
        meta &&
        (meta.verifiedSeq === undefined || ++syncs % VERIFY_EVERY === 0)
      )
        await verify();
      set({
        phase: "ready",
        progress: 1,
        syncedAt: meta?.syncedAt,
        error: undefined,
      });
    } catch (error) {
      set({
        phase: meta ? "ready" : "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Bring the copy up to date. Safe to call often. */
  function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = run().finally(() => {
      running = null;
      if (again) {
        again = false;
        void sync().catch(() => undefined);
      }
    });
    return running;
  }

  return {
    open,
    sync,
    verify: () => verify(),
    /** The books, assembled once per change; null before the first download. */
    books(): MockDb | null {
      if (!meta) return null;
      books ??= assembleBooks(
        meta.tables,
        rows.parties.values() as Iterable<Party>,
        rows.items.values() as Iterable<Item>,
        rows.vouchers.values() as Iterable<Voucher>,
      );
      return books;
    },
    state: () => state,
    seq: () => meta?.seq ?? null,
    checksum: (): ReplicaChecksum => ({
      parties: replicaChecksum(rows.parties.values()),
      items: replicaChecksum(rows.items.values()),
      vouchers: replicaChecksum(rows.vouchers.values()),
    }),
  };
}
export type Replica = ReturnType<typeof createReplica>;
