import { describe, expect, test } from "bun:test";
import type { BookScope, Party, Voucher } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  cancelVoucher,
  createNote,
  createPurchase,
  createSale,
} from "../src/mock/db";
import { finalAccounts } from "../src/accounting/generalLedger";
import { stockLots } from "../src/accounting/stockLots";
import { returnStockCost } from "../src/accounting/returnStockCost";
import {
  partyRefundCapacity,
  partySettlementDates,
} from "../src/accounting/refundCapacity";
import { scopeBooks } from "../src/accounting/bookScope";

const end = "2026-10-26";
const party = (type: Party["type"]): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 0,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
});

function books(scope: BookScope) {
  const db = blankBooks(
    {
      id: "fixture",
      name: "Financial fixture",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z5",
    },
    end,
  );
  db.parties = [party("customer"), party("supplier")];
  db.items = [
    {
      id: "item",
      name: "Item",
      code: "",
      hsn: "1001",
      group: "",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: 100,
      salePrice: 100,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
      openingBookScope: scope,
    },
  ];
  return db;
}

describe("A02: frozen sales-return stock costs", () => {
  for (const scope of ["gst", "nongst"] as const)
    for (const step of [1, 0.001])
      for (const cancel of [0, 1]) {
        test(`${scope}: ${step} units, cancel return ${cancel + 1}, fully return and resell`, () => {
          const db = books(scope);
          const purchase = createPurchase(db, {
            date: "2026-10-01",
            partyId: "supplier",
            bookScope: scope,
            lines: [
              {
                itemId: "item",
                qty: step * 3,
                rate: 100 / step,
                discountAmount: 200,
                gstRate: 18,
              },
            ],
          });
          expect(purchase.lines![0].stockCost).toBe(100);
          const baseline = finalAccounts(db).profitAndLoss.netProfit;
          const sale = createSale(db, {
            date: "2026-10-02",
            partyId: "customer",
            lines: [
              {
                itemId: "item",
                qty: step * 3,
                rate: 100 / step,
                gstRate: 18,
                stockLotId: purchase.lines![0].stockLotId,
              },
            ],
          });
          const note = (day: number) =>
            createNote(db, "credit-note", {
              againstId: sale.id,
              date: `2026-10-${day.toString().padStart(2, "0")}`,
              reason: "Return goods",
              lines: [{ index: 0, qty: step }],
            });
          const first = note(3),
            second = note(4);
          expect([
            first.lines![0].stockCost,
            second.lines![0].stockCost,
          ]).toEqual([33, 34]);
          const surviving = structuredClone([first, second][1 - cancel]);
          cancelVoucher(
            db,
            [first, second][cancel].id,
            "Correct return",
            "2026-10-05T00:00:00Z",
          );
          note(6);
          note(7);
          const active = db.vouchers.filter(
            (v) => v.type === "credit-note" && v.status === "posted",
          );
          expect(
            active.reduce((sum, v) => sum + v.lines![0].stockCost!, 0),
          ).toBe(100);
          expect(db.vouchers.find((v) => v.id === surviving.id)).toEqual(
            surviving,
          );
          const lot = stockLots(db.items[0], db.vouchers).find(
            (l) => l.id === purchase.lines![0].stockLotId,
          )!;
          expect(lot.qty).toBe(step * 3);
          expect(lot.value).toBe(100);
          expect(finalAccounts(db).profitAndLoss.netProfit).toBe(baseline);
          const resale = createSale(db, {
            date: "2026-10-08",
            partyId: "customer",
            lines: [
              {
                itemId: "item",
                qty: step * 3,
                rate: 100 / step,
                gstRate: 18,
                stockLotId: lot.id,
              },
            ],
          });
          expect(resale.lines![0].stockCost).toBe(100);
          expect(
            stockLots(db.items[0], db.vouchers).find((l) => l.id === lot.id)
              ?.value,
          ).toBe(0);
        });
      }
  const source: Voucher = {
    id: "sale",
    number: "S1",
    type: "sale",
    status: "posted",
    date: end,
    createdAt: end,
    partyId: "customer",
    bookScope: "nongst",
    amount: 100,
    lines: [{ itemId: "item", qty: 3, rate: 100, gstRate: 0, stockCost: 100 }],
  };
  const returned = (qty: number, cost: number): Voucher => ({
    ...source,
    id: "note",
    type: "credit-note",
    againstId: source.id,
    lines: [{ ...source.lines![0], sourceLine: 0, qty, stockCost: cost }],
  });
  test("large integer costs preserve the exact final paise", () => {
    const bill = {
      ...source,
      lines: [{ ...source.lines![0], stockCost: Number.MAX_SAFE_INTEGER }],
    };
    expect(returnStockCost(bill, [returned(1, 3002399751580330)], 0, 2)).toBe(
      6004799503160661,
    );
  });
  test("later-dated surviving returns consume the original cost", () => {
    expect(
      returnStockCost(
        source,
        [{ ...returned(1, 34), date: "2026-10-27" }],
        0,
        2,
      ),
    ).toBe(66);
  });
  test("existing excess costs require review without rewriting notes", () => {
    const prior = returned(2, 101),
      before = structuredClone(prior);
    expect(() => returnStockCost(source, [prior], 0, 1)).toThrow("exceed");
    expect(prior).toEqual(before);
  });
  test("missing costs are not guessed when the source has a saved basis", () => {
    const prior = returned(1, 33);
    delete prior.lines![0].stockCost;
    expect(() => returnStockCost(source, [prior], 0, 1)).toThrow(
      "saved stock costs",
    );
    const legacy = structuredClone(source);
    delete legacy.lines![0].stockCost;
    expect(returnStockCost(legacy, [], 0, 1)).toBeUndefined();
  });
});

function movement(
  p: Party,
  day: string,
  credit: number,
  scope: BookScope = "nongst",
): Voucher {
  const effect = credit * (p.type === "customer" ? -1 : 1);
  return {
    id: `${day}:${credit}`,
    type: "journal",
    number: day,
    status: "posted",
    date: day,
    createdAt: day,
    amount: Math.abs(credit),
    bookScope: scope,
    journalLines: [
      {
        account: `party:${p.id}`,
        name: p.name,
        debit: Math.max(effect, 0),
        credit: Math.max(-effect, 0),
      },
    ],
  };
}

describe("A03: dated party refund capacity", () => {
  test("funding checks include allocation-only and multi-party journal dates", () => {
    const p = party("customer");
    const allocation = { ...movement(p, "2026-10-05", 0), partyId: p.id };
    const journal = movement(p, "2026-10-07", 100);
    const ignored = {
      ...movement(p, "2026-10-09", 100),
      status: "cancelled" as const,
    };
    expect(
      partySettlementDates(
        p,
        [allocation, journal, ignored],
        "2026-10-02",
        end,
      ),
    ).toEqual(["2026-10-02", "2026-10-05", "2026-10-07", end]);
  });
  for (const type of ["customer", "supplier"] as const) {
    const p = party(type);
    test(`${type}: later funding cannot conceal exhausted credit`, () => {
      const entries = [
        movement(p, "2026-10-01", 10000),
        movement(p, "2026-10-05", -10000),
        movement(p, "2026-10-10", 10000),
      ];
      expect(partyRefundCapacity(p, entries, "2026-10-02", end)).toBe(0);
      expect(partyRefundCapacity(p, entries, "2026-10-10", end)).toBe(10000);
    });
    test(`${type}: only the smallest credit is available, including reversals`, () => {
      const entries = [
        movement(p, "2026-10-01", 10000),
        movement(p, "2026-10-05", -7000),
        movement(p, "2026-10-10", 7000),
      ];
      expect(partyRefundCapacity(p, entries, "2026-10-02", end)).toBe(3000);
      entries[1].status = "cancelled";
      expect(partyRefundCapacity(p, entries, "2026-10-02", end)).toBe(10000);
    });
    test(`${type}: same-day corrections share the report cutoff`, () => {
      const entries = [
        movement(p, "2026-10-01", 10000),
        movement(p, "2026-10-05", -10000),
        movement(p, "2026-10-05", 10000),
      ];
      expect(partyRefundCapacity(p, entries, "2026-10-02", end)).toBe(10000);
    });
    test(`${type}: future movements and other parties are excluded`, () => {
      const entries = [
        movement(p, "2026-10-01", 10000),
        movement(p, "2026-10-27", -10000),
        movement({ ...p, id: "other" }, "2026-10-05", -10000),
      ];
      expect(partyRefundCapacity(p, entries, "2026-10-02", end)).toBe(10000);
      expect(partyRefundCapacity(p, entries, "2026-09-30", end)).toBe(0);
    });
    test(`${type}: each book has its own opening and movements`, () => {
      const db = books("gst");
      db.parties = [
        {
          ...p,
          openingBalance: (type === "customer" ? -1 : 1) * 10000,
          openingGstBalance: 0,
        },
      ];
      db.vouchers = [
        movement(p, "2026-10-01", 10000, "gst"),
        movement(p, "2026-10-05", -10000, "gst"),
        movement(p, "2026-10-10", 10000, "gst"),
      ];
      const gst = scopeBooks(db, "gst"),
        non = scopeBooks(db, "nongst");
      expect(
        partyRefundCapacity(gst.parties[0], gst.vouchers, "2026-10-02", end),
      ).toBe(0);
      expect(
        partyRefundCapacity(non.parties[0], non.vouchers, "2026-10-02", end),
      ).toBe(10000);
    });
  }
});
