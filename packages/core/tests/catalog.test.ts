import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createNote,
  createOrder,
  createPurchase,
  createSale,
  updateInvoice,
} from "../src/mock/db";
import {
  checkSalesperson,
  isOwnRecord,
  salespersonIdsOf,
  salespersonOfUser,
  savedSalesperson,
  type Salesperson,
} from "../src/catalog";
import { buildReport } from "../src/reporting";
import {
  checkPriceList,
  cleanPriceList,
  parsePriceListCsv,
  priceListFor,
  priceListRate,
  type PriceList,
} from "../src/priceLists";
import { createParty, updateParty } from "../src/books/masters";

const TODAY = "2026-10-26";
const party = (type: Party["type"]): Party => ({
  id: type,
  name: type,
  type,
  phone: "",
  city: "Mathura",
  stateCode: "09",
  creditDays: 10,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
  ...(type === "supplier" ? { gstin: "09BBBBB1111B1ZL" } : {}),
});

export function books() {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    TODAY,
  );
  db.parties = [party("customer"), party("supplier")];
  db.items = [
    {
      id: "item",
      name: "Item",
      code: "IT",
      hsn: "1001",
      group: "",
      taxType: "taxable",
      gstRate: 18,
      unit: "Nos",
      purchasePrice: 10000,
      salePrice: 20000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  createPurchase(db, {
    partyId: "supplier",
    date: "2026-09-01",
    lines: [{ itemId: "item", qty: 50, rate: 10000, gstRate: 18 }],
    charges: [],
    supplierInvoiceNo: "S-1",
  });
  return db;
}

const RAVI: Salesperson = {
  id: "sp1",
  name: "Ravi",
  userId: "u3",
  active: true,
};
const OLD: Salesperson = { id: "sp2", name: "Old", active: false };
const line: InvoiceLine = { itemId: "item", qty: 1, rate: 10000, gstRate: 18 };

describe("salespersons (T10)", () => {
  test("names are unique, a login links to one salesperson", () => {
    expect(checkSalesperson({ name: " ", active: true }, [])).toHaveProperty(
      "name",
    );
    expect(
      checkSalesperson({ name: "ravi", active: true }, [RAVI]),
    ).toHaveProperty("name");
    expect(
      checkSalesperson({ name: "Ravi K", userId: "u3", active: true }, [RAVI]),
    ).toHaveProperty("userId");
    expect(
      checkSalesperson(
        { name: "Ravi", userId: "u3", active: true },
        [RAVI],
        "sp1",
      ),
    ).toEqual({});
  });

  test("the form default is the login's own active salesperson", () => {
    expect(salespersonOfUser([RAVI, OLD], "u3")?.id).toBe("sp1");
    expect(
      salespersonOfUser([{ ...RAVI, active: false }], "u3"),
    ).toBeUndefined();
    expect(salespersonOfUser([RAVI], undefined)).toBeUndefined();
  });

  test("a voucher keeps, clears or checks its salesperson", () => {
    const list = [RAVI, OLD];
    expect(savedSalesperson(list, "sale", "sp1")).toBe("sp1");
    expect(savedSalesperson(list, "sales-order", undefined)).toBeUndefined();
    expect(() => savedSalesperson(list, "sale", "sp2")).toThrow(
      "Pick a salesperson",
    );
    expect(() => savedSalesperson(list, "sale", "nobody")).toThrow();
    // An edit keeps one switched off since; undefined keeps, null clears.
    expect(savedSalesperson(list, "sale", "sp2", "sp2")).toBe("sp2");
    expect(savedSalesperson(list, "sale", undefined, "sp2")).toBe("sp2");
    expect(savedSalesperson(list, "sale", null, "sp2")).toBeUndefined();
    expect(() => savedSalesperson(list, "purchase", "sp1")).toThrow();
    expect(savedSalesperson(list, "purchase", undefined)).toBeUndefined();
  });

  test("own records: made by the member, or sold by them", () => {
    const ids = salespersonIdsOf([RAVI, OLD], "u3");
    expect(ids).toEqual(["sp1"]);
    expect(isOwnRecord({ createdBy: "u3" }, "u3", ids)).toBe(true);
    expect(
      isOwnRecord({ createdBy: "u1", salespersonId: "sp1" }, "u3", ids),
    ).toBe(true);
    expect(
      isOwnRecord({ createdBy: "u1", salespersonId: "sp2" }, "u3", ids),
    ).toBe(false);
    expect(isOwnRecord({ createdBy: "u1" }, "u3", [])).toBe(false);
  });

  test("sales and orders carry it; the reports group by it, returns netted", () => {
    const db = books();
    db.salespersons = [RAVI, OLD];
    const a = createSale(db, {
      partyId: "customer",
      date: "2026-10-10",
      lines: [{ ...line, qty: 3 }],
      charges: [],
      salespersonId: "sp1",
    });
    createSale(db, {
      partyId: "customer",
      date: "2026-10-11",
      lines: [line],
      charges: [],
    });
    expect(a.salespersonId).toBe("sp1");
    // Editing without a salesperson in the input keeps it.
    const edited = updateInvoice(
      db,
      a.id,
      {
        partyId: "customer",
        date: "2026-10-10",
        lines: [{ ...line, qty: 3 }],
        charges: [],
      },
      "2026-10-13T00:00:00Z",
    );
    expect(edited.salespersonId).toBe("sp1");
    createNote(db, "credit-note", {
      againstId: a.id,
      date: "2026-10-12",
      lines: [{ index: 0, qty: 1 }],
      reason: "Damaged",
    });
    const order = createOrder(db, "sales-order", {
      partyId: "customer",
      date: "2026-10-12",
      lines: [{ ...line, qty: 5 }],
      charges: [],
      salespersonId: "sp1",
    });
    expect(order.salespersonId).toBe("sp1");

    const report = (
      id: "sales-by-salesperson" | "sales-orders-by-salesperson",
    ) =>
      buildReport(
        { ...db, salespersons: db.salespersons },
        {
          report: id,
          from: "2026-10-01",
          to: TODAY,
          includeNarration: false,
          includeZeroBalances: false,
        },
      ).sections[0]!.rows;
    const sales = report("sales-by-salesperson");
    const ravi = sales.find((r) => r.cells[0] === "Ravi")!.cells;
    // 3 sold, 1 returned: net taxable ₹200, GST ₹36
    expect(ravi.slice(1, 5)).toEqual([1, 1, 20000, 3600]);
    const none = sales.find((r) => r.cells[0] === "No salesperson")!.cells;
    expect(none.slice(1, 5)).toEqual([1, 0, 10000, 1800]);
    expect(sales.at(-1)!.total).toBe(true);
    const orders = report("sales-orders-by-salesperson");
    expect(orders[0]!.cells).toEqual([
      "Ravi",
      1,
      1,
      order.amount,
      order.amount,
    ]);
  });
});

describe("price lists (T36)", () => {
  const items = [
    {
      id: "oil",
      name: "Oil",
      code: "OIL1",
      unit: "Nos",
      salePrice: 20000,
      purchasePrice: 15000,
    },
    {
      id: "soap",
      name: "Soap",
      code: "SOAP",
      unit: "Nos",
      altUnit: { name: "Box", factor: 12 },
      salePrice: 1000,
      purchasePrice: 800,
    },
    {
      id: "twin1",
      name: "Twin",
      code: "",
      unit: "Nos",
      salePrice: 1,
      purchasePrice: 1,
    },
    {
      id: "twin2",
      name: "Twin",
      code: "",
      unit: "Nos",
      salePrice: 1,
      purchasePrice: 1,
    },
  ];
  const list = (over: Partial<PriceList>): PriceList => ({
    id: "l",
    name: "L",
    side: "sale",
    mode: "percent",
    percent: 0,
    rates: [],
    isDefault: false,
    active: true,
    ...over,
  });

  test("a % list moves the item's own price up or down", () => {
    expect(priceListRate(list({ percent: -5 }), items[0]!)).toEqual({
      rate: 19000,
    });
    expect(
      priceListRate(list({ side: "purchase", percent: 2.5 }), items[0]!),
    ).toEqual({ rate: 15375 });
    expect(priceListRate(list({ percent: -100 }), items[0]!)).toEqual({
      rate: 0,
    });
  });

  test("a rates list gives per-unit rates; unlisted items fall back", () => {
    const l = list({
      mode: "rates",
      rates: [
        { itemId: "oil", rate: 18000 },
        { itemId: "soap", rate: 11000, unit: "Box" },
      ],
    });
    expect(priceListRate(l, items[0]!)).toEqual({ rate: 18000 });
    expect(priceListRate(l, items[1]!)).toEqual({ rate: 11000, unit: "Box" });
    expect(priceListRate(l, items[2]!)).toBeUndefined();
    expect(priceListRate(undefined, items[0]!)).toBeUndefined();
  });

  test("the party's own list wins, else the side's default", () => {
    const lists = [
      list({ id: "a", isDefault: true }),
      list({ id: "b" }),
      list({ id: "c", active: false }),
      list({ id: "p", side: "purchase", isDefault: true }),
    ];
    expect(priceListFor(lists, { priceListId: "b" }, "sale")?.id).toBe("b");
    expect(priceListFor(lists, {}, "sale")?.id).toBe("a");
    // A switched-off or other-side list is skipped.
    expect(priceListFor(lists, { priceListId: "c" }, "sale")?.id).toBe("a");
    expect(priceListFor(lists, { priceListId: "b" }, "purchase")?.id).toBe("p");
  });

  test("checks: name, percentage range, units and repeats", () => {
    const base = {
      name: "X",
      side: "sale" as const,
      mode: "rates" as const,
      rates: [],
      isDefault: false,
      active: true,
    };
    expect(
      checkPriceList({ ...base, name: "l" }, [list({})], items),
    ).toHaveProperty("name");
    expect(
      checkPriceList({ ...base, mode: "percent", percent: 1001 }, [], items),
    ).toHaveProperty("percent");
    expect(
      checkPriceList(
        { ...base, rates: [{ itemId: "oil", rate: 1, unit: "Box" }] },
        [],
        items,
      ).rates,
    ).toContain("not Box");
    expect(
      checkPriceList(
        {
          ...base,
          rates: [
            { itemId: "soap", rate: 1 },
            { itemId: "soap", rate: 2, unit: "Box" },
          ],
        },
        [],
        items,
      ),
    ).toEqual({});
    expect(
      checkPriceList(
        { ...base, rates: [{ itemId: "gone", rate: 1 }] },
        [],
        items,
      ),
    ).toHaveProperty("rates");
    expect(
      cleanPriceList(
        { ...base, rates: [{ itemId: "oil", rate: 5, unit: "Nos" }] },
        items,
      ).rates,
    ).toEqual([{ itemId: "oil", rate: 5 }]);
  });

  test("CSV import: code or name, rupees, unit; every bad line reported", () => {
    const ok = parsePriceListCsv(
      'Item,Rate,Unit\nOIL1,"1,250.50"\nsoap, 110, Box\n\nSoap,9',
      items,
    );
    expect(ok.errors).toEqual([]);
    expect(ok.rates).toEqual([
      { itemId: "oil", rate: 125050 },
      { itemId: "soap", rate: 11000, unit: "Box" },
      { itemId: "soap", rate: 900 },
    ]);
    const bad = parsePriceListCsv(
      "NOPE,1\nOIL1,abc\nOIL1,1,Kg\nTwin,1\nOIL1,1\nOIL1,2",
      items,
    );
    expect(bad.errors).toEqual([
      'Line 1: no item with code or name "NOPE".',
      'Line 2: "abc" isn\'t a rate in rupees.',
      "Line 3: Oil is sold in Nos, not Kg.",
      'Line 4: more than one item is called "Twin"; use its code.',
      "Line 6: Oil is already on line 5.",
    ]);
  });

  test("a party takes a list of its own side; null clears it", () => {
    const db = books();
    db.priceLists = [list({ id: "pl" }), list({ id: "pp", side: "purchase" })];
    const input = {
      name: "Shop",
      type: "customer" as const,
      phone: "",
      city: "",
      stateCode: "09",
      creditDays: 0,
      creditLimit: 0,
      openingBalance: 0,
    };
    const party = createParty(db, { ...input, priceListId: "pl" }, TODAY);
    expect(party.priceListId).toBe("pl");
    expect(() =>
      updateParty(db, party.id, { ...input, priceListId: "pp" }),
    ).toThrow("sale price list");
    expect(updateParty(db, party.id, input).priceListId).toBe("pl");
    expect(
      updateParty(db, party.id, { ...input, priceListId: null }).priceListId,
    ).toBeUndefined();
  });
});
