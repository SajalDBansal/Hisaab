import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import {
  createParty,
  createPurchase,
  createSale,
  updateInvoice,
} from "../src/mock/db";
import {
  checkCustomValues,
  fieldsFor,
  newCustomFieldKey,
  type CustomFieldDef,
} from "../src/customFields";

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: over.key ?? "id",
  key: "cf_aaaaaaaaaa",
  entity: "voucher",
  name: "Vehicle no.",
  kind: "text",
  choices: [],
  required: false,
  active: true,
  print: false,
  voucherTypes: [],
  position: 0,
  version: 1,
  ...over,
});

const VEHICLE = def({
  key: "cf_vehicle000",
  required: true,
  voucherTypes: ["sale"],
});
const AREA = def({
  key: "cf_area000000",
  entity: "party",
  name: "Area",
  kind: "choice",
  choices: ["North", "South"],
});

function books() {
  const db = blankBooks(
    {
      id: "f",
      name: "F",
      city: "Mathura",
      stateCode: "09",
      gstRegistration: "regular",
      gstin: "09AAAAA0000A1Z0",
    },
    "2026-10-26",
  );
  const party = (type: Party["type"]): Party => ({
    id: type,
    name: type,
    type,
    phone: "",
    city: "Mathura",
    stateCode: "09",
    creditDays: 15,
    creditLimit: 0,
    openingBalance: 0,
    openingDate: "2026-04-01",
    ...(type === "supplier" ? { gstin: "09BBBBB1111B1ZL" } : {}),
  });
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
      purchasePrice: 10000,
      salePrice: 20000,
      mrp: 0,
      reorderLevel: 0,
      openingStock: 0,
    },
  ];
  db.customFieldDefs = [VEHICLE, AREA];
  createPurchase(db, {
    date: "2026-10-01",
    partyId: "supplier",
    lines: [line],
  });
  return db;
}
const line: InvoiceLine = { itemId: "item", qty: 1, rate: 20000, gstRate: 18 };

describe("custom fields (doc 37, T07)", () => {
  test("keys are permanent-looking and well formed", () => {
    expect(newCustomFieldKey()).toMatch(/^cf_[a-z0-9]{10}$/);
  });

  test("voucher fields show only on their voucher types", () => {
    expect(fieldsFor([VEHICLE], "voucher", "sale")).toHaveLength(1);
    expect(fieldsFor([VEHICLE], "voucher", "purchase")).toHaveLength(0);
    expect(fieldsFor([VEHICLE], "voucher", "receipt")).toHaveLength(0);
  });

  test("values are checked by kind; unknown keys and bad choices are refused", () => {
    expect(() =>
      checkCustomValues([AREA], "party", { cf_zzzzzzzzzz: "x" }),
    ).toThrow("does not belong");
    expect(() =>
      checkCustomValues([AREA], "party", { [AREA.key]: "East" }),
    ).toThrow("Area has an invalid value");
    expect(checkCustomValues([AREA], "party", { [AREA.key]: "North" })).toEqual(
      {
        [AREA.key]: "North",
      },
    );
  });

  test("a form must fill required fields; entries made without a form are not blocked", () => {
    const db = books();
    expect(() =>
      createSale(db, {
        date: "2026-10-10",
        partyId: "customer",
        lines: [line],
        customFields: {},
      }),
    ).toThrow("Vehicle no. is required");
    // No value map at all (an order conversion or split sale): allowed.
    expect(() =>
      createSale(db, {
        date: "2026-10-10",
        partyId: "customer",
        lines: [line],
      }),
    ).not.toThrow();
  });

  test("values are saved on the voucher and kept when an edit doesn't send them", () => {
    const db = books();
    db.customFieldDefs = [{ ...VEHICLE, required: false }];
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: "customer",
      lines: [line],
      customFields: { [VEHICLE.key]: " UP85 AB 1234 " },
    });
    expect(sale.customFields).toEqual({ [VEHICLE.key]: "UP85 AB 1234" });
    const edited = updateInvoice(
      db,
      sale.id,
      { date: "2026-10-10", partyId: "customer", lines: [line] },
      "2026-10-26T00:00:00Z",
    );
    expect(edited.customFields).toEqual({ [VEHICLE.key]: "UP85 AB 1234" });
  });

  test("party values are saved and frozen into the bill's snapshot", () => {
    const db = books();
    db.customFieldDefs = [{ ...VEHICLE, required: false }, AREA];
    const party = createParty(
      db,
      {
        name: "Ravi",
        type: "customer",
        phone: "",
        city: "Mathura",
        stateCode: "09",
        creditDays: 0,
        creditLimit: 0,
        openingBalance: 0,
        customFields: { [AREA.key]: "South" },
      },
      "2026-10-10",
    );
    const sale = createSale(db, {
      date: "2026-10-10",
      partyId: party.id,
      lines: [line],
    });
    party.customFields = { [AREA.key]: "North" };
    expect(sale.snapshot?.party?.customFields).toEqual({ [AREA.key]: "South" });
  });
});
