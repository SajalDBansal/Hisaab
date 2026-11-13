import type { MockDb } from "@repo/core";
import type { FastifyInstance } from "fastify";
import { withReportBooksStore } from "@repo/backend/modules/reports/books";

// Reads between two saves share one load of the firm's books. Each GET runs
// with the store for its firm's current data version; a save bumps the
// version, so the next read starts a new store and never sees old books.
// Writes run without a store and always read the database inside their lock.
// This is a cache, not state: losing it costs one reload.

const TTL_MS = 60_000;
const MAX_STORES = 50;
const FIRM_ID = /^[0-9a-f-]{36}$/i;

export function registerBooksCache(app: FastifyInstance) {
  const stores = new Map<
    string,
    { at: number; books: Map<string, Promise<MockDb>> }
  >();
  const storeFor = (key: string) => {
    const now = Date.now();
    const hit = stores.get(key);
    if (hit && now - hit.at < TTL_MS) return hit.books;
    const books = new Map<string, Promise<MockDb>>();
    stores.set(key, { at: now, books });
    while (stores.size > MAX_STORES)
      stores.delete(stores.keys().next().value as string);
    return books;
  };

  app.addHook("onRequest", (req, _reply, done) => {
    const firmId = req.headers["x-firm-id"];
    if (
      req.method !== "GET" ||
      typeof firmId !== "string" ||
      !FIRM_ID.test(firmId)
    )
      return done();
    app.firmVersion(firmId).then(
      (version) => withReportBooksStore(storeFor(`${firmId}:${version}`), done),
      () => done(),
    );
  });
}
