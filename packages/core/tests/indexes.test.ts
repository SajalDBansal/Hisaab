import { describe, expect, test } from "bun:test";
import { buildSeed } from "../src/mock/seed";
import {
  collectionBills,
  partyBalance,
  partyBills,
  vouchersByParty,
} from "../src/accounting/bills";
import {
  stockLots,
  stockLotsFor,
  vouchersByItem,
} from "../src/accounting/stockLots";
import { stockQty } from "../src/accounting/stock";

// The demo books hold sales, purchases, returns, receipts with allocations,
// journals and opening balances: enough to catch a missing voucher in an index.
const books = buildSeed("2026-10-26");
const dates = ["2026-06-30", "2026-09-15", "2026-10-26"];

describe("per-party index gives whole-book answers", () => {
  const byParty = vouchersByParty(books.parties, books.vouchers);
  for (const party of books.parties)
    test(party.name, () => {
      const own = byParty.get(party.id) ?? [];
      for (const date of dates) {
        expect(partyBalance(party, own, date)).toBe(
          partyBalance(party, books.vouchers, date),
        );
        expect(partyBills(party, own, date)).toEqual(
          partyBills(party, books.vouchers, date),
        );
        expect(collectionBills(party, own, date)).toEqual(
          collectionBills(party, books.vouchers, date),
        );
      }
    });
});

describe("per-item index gives whole-book answers", () => {
  const byItem = vouchersByItem(books.vouchers);
  test("lots of every item, on several dates", () => {
    for (const date of [...dates, undefined]) {
      const indexed = stockLotsFor(books.items, books.vouchers, date);
      books.items.forEach((item, i) =>
        expect(indexed[i]).toEqual(stockLots(item, books.vouchers, date)),
      );
    }
  });
  test("stock quantities", () => {
    for (const item of books.items)
      expect(stockQty(item, byItem.get(item.id) ?? [])).toBe(
        stockQty(item, books.vouchers),
      );
  });
});
