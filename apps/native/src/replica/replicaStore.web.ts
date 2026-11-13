import type { ReplicaKind, ReplicaMeta, ReplicaStore } from "@repo/core";
import { REPLICA_KINDS } from "@repo/core";
import { offlineStore } from "@/data/offlineStore";

/** Browsers keep the books too, in the encrypted offline store. */
export const replicaSupported = true;

const metaKey = (owner: string) => `replica:${owner}:meta`;
const kindKey = (owner: string, kind: ReplicaKind) =>
  `replica:${owner}:${kind}`;
const OWNERS = "replica:owners";

type Table = Record<string, string>;

async function table(owner: string, kind: ReplicaKind): Promise<Table> {
  const text = await offlineStore.get(kindKey(owner, kind));
  return text ? (JSON.parse(text) as Table) : {};
}

/**
 * One encrypted record per firm and table. Each write rewrites the tables it
 * touches, under the store's lock so writes never interleave.
 */
export const replicaStore: ReplicaStore = {
  async read(owner) {
    const metaText = await offlineStore.get(metaKey(owner));
    const rows: { kind: ReplicaKind; json: string }[] = [];
    for (const kind of REPLICA_KINDS)
      for (const json of Object.values(await table(owner, kind)))
        rows.push({ kind, json });
    return {
      meta: metaText ? (JSON.parse(metaText) as ReplicaMeta) : null,
      rows,
    };
  },
  async write(owner, batch) {
    await offlineStore.lock(`replica:${owner}`, async () => {
      for (const kind of REPLICA_KINDS) {
        const upserts = batch.upserts.filter((r) => r.kind === kind);
        const removes = batch.removes.filter((r) => r.kind === kind);
        if (!batch.reset && !upserts.length && !removes.length) continue;
        const rows = batch.reset ? {} : await table(owner, kind);
        for (const r of upserts) rows[r.id] = r.json;
        for (const r of removes) delete rows[r.id];
        await offlineStore.set(kindKey(owner, kind), JSON.stringify(rows));
      }
      await offlineStore.set(metaKey(owner), JSON.stringify(batch.meta));
      const owners = new Set(
        JSON.parse((await offlineStore.get(OWNERS)) ?? "[]") as string[],
      );
      if (!owners.has(owner)) {
        owners.add(owner);
        await offlineStore.set(OWNERS, JSON.stringify([...owners]));
      }
    });
  },
  async clear(owner) {
    const owners = owner
      ? [owner]
      : (JSON.parse((await offlineStore.get(OWNERS)) ?? "[]") as string[]);
    for (const o of owners) {
      await offlineStore.remove(metaKey(o));
      for (const kind of REPLICA_KINDS)
        await offlineStore.remove(kindKey(o, kind));
    }
    if (!owner) await offlineStore.remove(OWNERS);
  },
};
