import { describe, expect, test } from "bun:test";
import { canSeeCosts, costPayloadForRead } from "../src/permissions";

const lot = {
  id: "purchase:v1:0",
  itemId: "i",
  number: "PI/26-27/0001",
  date: "2026-10-01",
  bookScope: "gst",
  qty: 4,
  value: 40000,
  unitCost: 10000,
  minimumQty: 4,
};
const saleDetail = {
  id: "v2",
  type: "sale",
  number: "SI/26-27/0001",
  amount: 17700,
  lines: [
    { itemId: "i", qty: 1, rate: 15000, stockLotId: lot.id, stockCost: 10000 },
  ],
  snapshot: {
    items: [
      {
        id: "i",
        name: "Item",
        salePrice: 15000,
        purchasePrice: 10000,
        openingCost: 9000,
        openingLots: [{ id: "o", qty: 2, unitCost: 9000, bookScope: "gst" }],
      },
    ],
  },
  report: { value: 123 },
};

describe("who sees purchase costs", () => {
  test.each([
    ["owner", true],
    ["accountant", true],
    ["viewer", true],
    ["sales", false],
  ] as const)("%s: %p", (role, expected) => {
    expect(canSeeCosts(role)).toBe(expected);
  });

  test("sales staff get every cost blanked, nothing else", () => {
    const seen = costPayloadForRead("sales", { lots: [lot], sale: saleDetail });
    expect(seen.lots[0]).toEqual({ ...lot, value: 0, unitCost: 0 });
    expect(seen.sale.lines[0].stockCost).toBe(0);
    expect(seen.sale.snapshot.items[0]).toMatchObject({
      salePrice: 15000,
      purchasePrice: 0,
      openingCost: 0,
    });
    expect(seen.sale.snapshot.items[0].openingLots[0].unitCost).toBe(0);
    // Sale prices, amounts and unrelated "value" fields stay as they are.
    expect(seen.sale.amount).toBe(17700);
    expect(seen.sale.lines[0].rate).toBe(15000);
    expect(seen.sale.report.value).toBe(123);
  });

  test("roles that may see costs get the payload untouched", () => {
    const payload = { lots: [lot], sale: saleDetail };
    expect(costPayloadForRead("viewer", payload)).toBe(payload);
    expect(costPayloadForRead("owner", payload)).toBe(payload);
  });

  test("the original answer is never modified", () => {
    const before = structuredClone(saleDetail);
    costPayloadForRead("sales", saleDetail);
    expect(saleDetail).toEqual(before);
  });
});
