/**
 * Timing of the report and save paths on a synthetic year of books.
 * Run: bun packages/core/bench/books.bench.ts [items] [vouchers]
 * Not part of the test suite; numbers depend on the machine.
 */
import type { Item, Party, Voucher } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  closingStockValue,
  finalAccounts,
  trialBalance,
} from "../src/accounting/generalLedger";
import { computeDashboard } from "../src/accounting/reports";
import { selectStockLines } from "../src/accounting/stockLots";

const items = Number(process.argv[2] ?? 500);
const count = Number(process.argv[3] ?? 25000);
const partiesCount = 400;

const books = blankBooks(
  { id: "f", name: "Bench", city: "Mathura", stateCode: "09", gstRegistration: "regular", gstin: "09AAAAA0000A1Z0" },
  "2027-03-31",
);
books.items = Array.from({ length: items }, (_, i): Item => ({
  id: `i${i}`, name: `Item ${i}`, code: "", hsn: "1001", group: "", taxType: "taxable", gstRate: 18,
  unit: "Nos", purchasePrice: 10000, salePrice: 15000, mrp: 0, reorderLevel: 5, openingStock: 0,
}));
books.parties = Array.from({ length: partiesCount }, (_, i): Party => ({
  id: `p${i}`, name: `Party ${i}`, type: i % 4 ? "customer" : "supplier", phone: "", city: "Mathura",
  stateCode: "09", creditDays: 15, creditLimit: 0, openingBalance: 0, openingDate: "2026-04-01",
  gstin: i % 4 ? undefined : "09BBBBB1111B1ZL",
}));
const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 3, 1) + (n % 360) * 86400000);
  return d.toISOString().slice(0, 10);
};
const vouchers: Voucher[] = [];
// One purchase lot per item every ~10 sales; sales consume the latest lot of their item.
const lastLot = new Map<string, string>();
for (let n = 0; n < count; n++) {
  const itemId = `i${n % items}`;
  const date = day(Math.floor((n / count) * 360));
  const createdAt = new Date(Date.UTC(2026, 3, 1) + n * 1000).toISOString();
  const purchase = !lastLot.has(itemId) || n % 10 === 0;
  if (purchase) {
    const id = `v${n}`;
    const lot = `purchase:${id}:0`;
    lastLot.set(itemId, lot);
    vouchers.push({ id, type: "purchase", number: `P${n}`, date, status: "posted", partyId: `p${(n % 100) * 4}`,
      taxMode: "regular", bookScope: "gst", interState: false, createdAt, amount: 11800 * 20,
      lines: [{ itemId, qty: 20, rate: 10000, gstRate: 18, exactMath: true, stockLotId: lot, stockCost: 200000, bookScope: "gst" }] });
  } else {
    vouchers.push({ id: `v${n}`, type: "sale", number: `S${n}`, date, status: "posted", partyId: `p${(n % 300) + 1 + Math.floor((n % 300) / 3)}`,
      taxMode: "regular", bookScope: "gst", interState: false, createdAt, amount: 17700,
      lines: [{ itemId, qty: 1, rate: 15000, gstRate: 18, exactMath: true, stockLotId: lastLot.get(itemId), stockCost: 10000, bookScope: "gst" }] });
  }
}
// Fresh stock for the timed sale.
vouchers.push({ id: "fresh", type: "purchase", number: "PF", date: "2027-03-01", status: "posted", partyId: "p0",
  taxMode: "regular", bookScope: "gst", interState: false, createdAt: "2027-03-01T00:00:00.000Z", amount: 1180000,
  lines: [{ itemId: "i1", qty: 100, rate: 10000, gstRate: 18, exactMath: true, stockLotId: "purchase:fresh:0", stockCost: 1000000, bookScope: "gst" }] });
books.vouchers = vouchers;

const time = (label: string, run: () => unknown) => {
  const start = performance.now();
  run();
  console.log(`${label.padEnd(34)} ${(performance.now() - start).toFixed(0).padStart(6)} ms`);
};
console.log(`items=${items} vouchers=${count} parties=${partiesCount}`);
time("closingStockValue", () => closingStockValue(books.items, books.vouchers, "2027-03-31"));
time("trialBalance", () => trialBalance(books));
time("finalAccounts (FY period)", () => finalAccounts(books, "2027-03-31", "2026-04-01"));
time("computeDashboard", () =>
  computeDashboard({ parties: books.parties, items: books.items, ledgers: books.ledgers, vouchers: books.vouchers, asOf: "2027-03-31" }));
time("selectStockLines (one sale)", () =>
  selectStockLines(books.items, books.vouchers, [{ itemId: "i1", qty: 1, rate: 15000, gstRate: 18 }], "2027-03-31"));
