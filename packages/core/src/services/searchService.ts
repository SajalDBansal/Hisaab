import { stockQty } from "../accounting/stock";
import { partyBalance } from "../accounting/bills";
import { parseRupees } from "../money";
import type { ISODate, Paise, VoucherType } from "../types";
import { clone, delay, getDb } from "./client";

export interface SearchHit {
  kind: "party" | "item" | "voucher" | "ledger";
  id: string;
  title: string;
  subtitle: string;
  amount?: Paise;
  /** Vouchers only, so the app can show "Sale · 04-09-2026". */
  voucherType?: VoucherType;
  date?: ISODate;
  cancelled?: boolean;
}

export interface SearchResults {
  query: string;
  parties: SearchHit[];
  items: SearchHit[];
  vouchers: SearchHit[];
  ledgers: SearchHit[];
}

const LIMIT = 8;
/** Lower case, no spaces or slashes, so "si 25", "SI/26-27/0025" and "0025" all match. */
const norm = (s: string) => s.toLowerCase().replace(/[\s/\\-]+/g, "");

export const searchService = {
  /**
   * One box for everything: parties (name, phone, GSTIN, city), items (name, code, HSN),
   * vouchers (number, party, reference, exact amount) and cash/bank accounts.
   * Real API: http.get<SearchResults>(`/search?q=${encodeURIComponent(query)}`)
   */
  async search(query: string): Promise<SearchResults> {
    await delay();
    const db = getDb();
    const q = norm(query);
    const empty = { query, parties: [], items: [], vouchers: [], ledgers: [] };
    if (q.length < 2) return empty;
    const has = (...fields: (string | undefined)[]) =>
      fields.some((f) => f && norm(f).includes(q));
    const amount = /^[\d,.]+$/.test(query.trim())
      ? parseRupees(query.trim())
      : null;

    const parties = db.parties
      .filter((p) => has(p.name, p.phone, p.gstin, p.city))
      .slice(0, LIMIT)
      .map((p) => ({
        kind: "party" as const,
        id: p.id,
        title: p.name,
        subtitle: `${p.type === "customer" ? "Customer" : "Supplier"} · ${p.city}`,
        amount: partyBalance(p, db.vouchers),
      }));

    const items = db.items
      .filter((i) => has(i.name, i.code, i.hsn))
      .slice(0, LIMIT)
      .map((i) => ({
        kind: "item" as const,
        id: i.id,
        title: i.name,
        subtitle: `${i.code ? `${i.code} · ` : ""}${stockQty(i, db.vouchers)} ${i.unit} in stock`,
        amount: i.salePrice,
      }));

    const partyName = (id?: string) =>
      db.parties.find((p) => p.id === id)?.name ?? "";
    const vouchers = db.vouchers
      .filter(
        (v) =>
          has(v.number, v.reference, v.narration, v.expenseHead) ||
          (v.partyId && has(partyName(v.partyId))) ||
          (amount !== null && amount > 0 && v.amount === amount),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, LIMIT * 2)
      .map((v) => ({
        kind: "voucher" as const,
        id: v.id,
        title: `${v.number}${v.partyId ? ` · ${partyName(v.partyId)}` : v.expenseHead ? ` · ${v.expenseHead}` : ""}`,
        subtitle: v.reference ?? "",
        amount: v.amount,
        voucherType: v.type,
        date: v.date,
        cancelled: v.status === "cancelled",
      }));

    const ledgers = db.ledgers
      .filter((l) => has(l.name, l.shortName))
      .map((l) => ({
        kind: "ledger" as const,
        id: l.id,
        title: l.name,
        subtitle: l.kind === "cash" ? "Cash book" : "Bank book",
      }));

    return clone({ query, parties, items, vouchers, ledgers });
  },
};
