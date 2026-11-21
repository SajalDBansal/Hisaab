import { describe, expect, test } from "bun:test";
import type { InvoiceLine, Item, Party } from "../src/types";
import { blankBooks } from "../src/mock/seed";
import { createNote, createPurchase, createSale } from "../src/mock/db";
import { gstr1 } from "../src/accounting/gst";
import {
  gstr1Json,
  Gstr1JsonError,
  type Gstr1JsonItem,
} from "../src/accounting/gstr1Json";

const party = (
  id: string,
  stateCode: string,
  gstin?: string,
  type: Party["type"] = "customer",
): Party => ({
  id,
  name: id,
  type,
  phone: "",
  city: "",
  stateCode,
  gstin,
  creditDays: 30,
  creditLimit: 0,
  openingBalance: 0,
  openingDate: "2026-04-01",
});
const item = (
  id: string,
  hsn: string,
  gstRate: Item["gstRate"],
  taxType: Item["taxType"],
  unit = "Kg",
): Item => ({
  id,
  name: id,
  code: "",
  hsn,
  group: "",
  taxType,
  gstRate,
  unit,
  purchasePrice: 1000,
  salePrice: 2000,
  mrp: 0,
  reorderLevel: 0,
  openingStock: 0,
});
const line = (
  itemId: string,
  qty: number,
  rate: number,
  gstRate: InvoiceLine["gstRate"],
  taxType: InvoiceLine["taxType"] = "taxable",
): InvoiceLine => ({ itemId, qty, rate, gstRate, taxType });

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
  db.parties = [
    party("Reg UP", "09", "09CCCCC2222C1ZM"),
    party("Reg Delhi", "07", "07BBBBB1111B1ZL"),
    party("Walk-in", "09"),
    party("Mumbai buyer", "27"),
    party("Supplier", "09", "09DDDDD3333D1ZN", "supplier"),
  ];
  db.items = [
    item("rice", "1006", 5, "taxable"),
    item("oil", "1512", 18, "taxable", "Ltr"),
    item("salt", "2501", 0, "nil"),
  ];
  createPurchase(db, {
    date: "2026-10-01",
    partyId: "Supplier",
    lines: [
      line("rice", 10_000, 1000, 5),
      line("oil", 10_000, 1000, 18),
      line("salt", 10_000, 500, 0, "nil"),
    ],
  });
  return db;
}

const sumItems = (items: Gstr1JsonItem[], key: "txval" | "tax") =>
  items.reduce(
    (n, i) =>
      n +
      (key === "txval"
        ? i.itm_det.txval
        : (i.itm_det.iamt ?? 0) +
          (i.itm_det.camt ?? 0) +
          (i.itm_det.samt ?? 0)),
    0,
  );
const paise = (rupees: number) => Math.round(rupees * 100);

describe("GSTR-1 JSON (T31)", () => {
  test("sections, formats and totals match the GSTR-1 working", () => {
    const db = books();
    const b2bIntra = createSale(db, {
      date: "2026-10-03",
      partyId: "Reg UP",
      lines: [
        line("rice", 10, 3333, 5),
        line("oil", 3, 12_345, 18),
        line("salt", 5, 1000, 0, "nil"),
      ],
      charges: [{ name: "Freight", amount: 5000, gstRate: 18 }],
    });
    const b2bInter = createSale(db, {
      date: "2026-10-04",
      partyId: "Reg Delhi",
      lines: [line("oil", 7, 9999, 18)],
    });
    // Interstate, unregistered, over ₹1,00,000 → B2C Large
    const large = createSale(db, {
      date: "2026-10-05",
      partyId: "Mumbai buyer",
      lines: [line("oil", 100, 1_00_000, 18)],
    });
    // Interstate, unregistered, exactly ₹1,00,000 → B2C Small
    createSale(db, {
      date: "2026-10-06",
      partyId: "Mumbai buyer",
      lines: [line("rice", 1, 95_23_810, 5)],
    });
    createSale(db, {
      date: "2026-10-07",
      partyId: "Walk-in",
      lines: [line("rice", 3, 4999, 5), line("oil", 1, 777, 18)],
    });
    // Credit notes: registered, against B2C Large, against B2C Small
    createNote(db, "credit-note", {
      againstId: b2bInter.id,
      date: "2026-10-10",
      reason: "Damaged",
      lines: [{ index: 0, qty: 2 }],
    });
    createNote(db, "credit-note", {
      againstId: large.id,
      date: "2026-10-11",
      reason: "Damaged",
      lines: [{ index: 0, qty: 10 }],
    });
    const walkIn = db.vouchers.find(
      (v) => v.type === "sale" && v.partyId === "Walk-in",
    )!;
    createNote(db, "credit-note", {
      againstId: walkIn.id,
      date: "2026-10-12",
      reason: "Damaged",
      lines: [{ index: 0, qty: 1 }],
    });

    const working = gstr1(
      db.vouchers,
      db.parties,
      db.items,
      "2026-10",
      db.units,
    );
    const { json, warnings, fileName } = gstr1Json(db, "2026-10");
    expect(fileName).toBe("GSTR1_09AAAAA0000A1Z0_102026");
    expect(json.gstin).toBe("09AAAAA0000A1Z0");
    expect(json.fp).toBe("102026");
    expect(warnings).toEqual([]);

    // B2B: one entry per GSTIN, invoice by invoice, one item per rate
    expect(json.b2b!.map((b) => b.ctin).sort()).toEqual([
      "07BBBBB1111B1ZL",
      "09CCCCC2222C1ZM",
    ]);
    const up = json.b2b!.find((b) => b.ctin === "09CCCCC2222C1ZM")!.inv[0];
    expect(up).toMatchObject({
      inum: b2bIntra.number,
      idt: "03-10-2026",
      val: b2bIntra.amount / 100,
      pos: "09",
      rchrg: "N",
      inv_typ: "R",
    });
    expect(up.itms.map((i) => i.itm_det.rt)).toEqual([5, 18]);
    expect(up.itms[0].itm_det.iamt).toBeUndefined();
    expect(up.itms[0].itm_det.csamt).toBe(0);
    const delhi = json.b2b!.find((b) => b.ctin === "07BBBBB1111B1ZL")!.inv[0];
    expect(delhi.pos).toBe("07");
    expect(delhi.itms[0].itm_det.camt).toBeUndefined();
    expect(delhi.itms[0].itm_det.iamt).toBeGreaterThan(0);

    // B2C Large only above the limit
    expect(json.b2cl).toHaveLength(1);
    expect(json.b2cl![0].pos).toBe("27");
    expect(json.b2cl![0].inv.map((i) => i.inum)).toEqual([large.number]);

    // Amounts are rupees with at most 2 decimals
    const text = JSON.stringify(json);
    for (const n of text.match(/-?\d+\.\d+/g) ?? [])
      expect(n.split(".")[1].length).toBeLessThanOrEqual(2);

    // Every sale's GST-charged part is in exactly one of B2B / B2CL / B2CS,
    // and B2CS is net of the credit note against a small bill.
    const b2bTx = json.b2b!.flatMap((b) => b.inv).flatMap((i) => i.itms);
    const b2clTx = json.b2cl!.flatMap((b) => b.inv).flatMap((i) => i.itms);
    const b2csTaxable = json.b2cs!.reduce((n, r) => n + paise(r.txval), 0);
    const b2csTax = json.b2cs!.reduce(
      (n, r) => n + paise((r.iamt ?? 0) + (r.camt ?? 0) + (r.samt ?? 0)),
      0,
    );
    const smallNote = working.creditNotes.find(
      (n) => !n.gstin && n.againstNumber === walkIn.number,
    )!;
    expect(
      paise(sumItems(b2bTx, "txval")) +
        paise(sumItems(b2clTx, "txval")) +
        b2csTaxable +
        smallNote.taxable,
    ).toBe(working.totals.taxable);
    expect(
      paise(sumItems(b2bTx, "tax")) +
        paise(sumItems(b2clTx, "tax")) +
        b2csTax +
        smallNote.tax,
    ).toBe(working.totals.tax);
    // B2B and B2C Large match the working's tables exactly
    expect(paise(sumItems(b2bTx, "txval"))).toBe(
      working.b2b.reduce((n, r) => n + r.taxable, 0),
    );
    expect(paise(sumItems(b2clTx, "txval"))).toBe(working.b2cl[0].taxable);
    expect(
      json.b2cs!.find((r) => r.sply_ty === "INTER" && r.pos === "27"),
    ).toMatchObject({ typ: "OE", rt: 5 });

    // Credit notes: registered → cdnr, against B2CL → cdnur
    expect(json.cdnr![0].ctin).toBe("07BBBBB1111B1ZL");
    expect(json.cdnr![0].nt[0]).toMatchObject({ ntty: "C", pos: "07" });
    expect(json.cdnur).toHaveLength(1);
    expect(json.cdnur![0]).toMatchObject({ typ: "B2CL", pos: "27" });
    const notesTaxable =
      json
        .cdnr!.flatMap((c) => c.nt)
        .reduce((n, t) => n + paise(sumItems(t.itms, "txval")), 0) +
      json.cdnur!.reduce((n, t) => n + paise(sumItems(t.itms, "txval")), 0) +
      smallNote.taxable;
    expect(notesTaxable).toBe(
      working.creditNotes.reduce((n, c) => n + c.taxable, 0),
    );

    // Table 8: the nil-rated salt to a registered buyer within the state
    expect(json.nil!.inv).toEqual([
      { sply_ty: "INTRAB2B", nil_amt: 50, expt_amt: 0, ngsup_amt: 0 },
    ]);

    // HSN: rate-wise, B2B/B2C split, same totals as the working; freight is a service
    const hsn = [...json.hsn!.hsn_b2b, ...json.hsn!.hsn_b2c];
    expect(hsn.reduce((n, r) => n + paise(r.txval), 0)).toBe(
      working.hsn.reduce((n, r) => n + r.taxable, 0),
    );
    expect(hsn.reduce((n, r) => n + paise(r.iamt + r.camt + r.samt), 0)).toBe(
      working.hsn.reduce((n, r) => n + r.cgst + r.sgst + r.igst, 0),
    );
    const freight = json.hsn!.hsn_b2b.find((r) => r.hsn_sc === "9965")!;
    expect(freight).toMatchObject({ uqc: "NA", qty: 0, rt: 18 });
    const oil = json.hsn!.hsn_b2b.find((r) => r.hsn_sc === "1512")!;
    expect(oil).toMatchObject({ uqc: "LTR", qty: 8, rt: 18 }); // 3 + 7 − 2 returned
    expect(json.hsn!.hsn_b2b.map((r) => r.num)).toEqual(
      json.hsn!.hsn_b2b.map((_, i) => i + 1),
    );

    // Table 13
    expect(json.doc_issue!.doc_det.map((d) => d.doc_num)).toEqual([1, 5]);
    expect(json.doc_issue!.doc_det[0].docs[0]).toMatchObject({
      num: 1,
      totnum: 5,
      cancel: 0,
      net_issue: 5,
    });
    expect(json.doc_issue!.doc_det[1].docs[0].totnum).toBe(3);
  });

  test("warnings for what the portal would refuse; no GSTIN, no file", () => {
    const db = books();
    db.items.push(item("loose", "", 5, "taxable"));
    db.parties.push(party("Bad GSTIN", "09", "09XXXX"));
    createPurchase(db, {
      date: "2026-10-01",
      partyId: "Supplier",
      lines: [line("loose", 10, 500, 5)],
    });
    createSale(db, {
      date: "2026-10-03",
      partyId: "Bad GSTIN",
      lines: [line("rice", 1, 1000, 5), line("loose", 1, 1000, 5)],
    });
    const { warnings } = gstr1Json(db, "2026-10");
    expect(warnings.some((w) => w.includes("GSTIN 09XXXX is not valid"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("loose has no valid HSN"))).toBe(
      true,
    );
    // Empty month: only the header
    expect(gstr1Json(db, "2026-09").json).toEqual({
      gstin: "09AAAAA0000A1Z0",
      fp: "092026",
      version: expect.any(String),
      hash: "hash",
    });
    db.firm.gstin = "";
    expect(() => gstr1Json(db, "2026-10")).toThrow(Gstr1JsonError);
  });
});
