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
