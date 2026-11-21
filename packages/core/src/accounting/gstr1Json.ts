/**
 * GSTR-1 JSON (doc 37, T31): the return file the GST portal accepts under
 * Returns → GSTR-1 → Prepare offline → Upload, and that the GST Offline Tool
 * opens. It is built from the same book working as the GSTR-1 screen
 * (`gstr1` in gst.ts) and is only a download: Hisaab never talks to the portal.
 *
 * Sections produced (empty ones are left out, as the offline tool does):
 *   b2b       4A   registered buyers, invoice by invoice, one item per GST rate
 *   b2cl      5    interstate bills to unregistered buyers above ₹1,00,000
 *   b2cs      7    other unregistered sales by supply type, place of supply and
 *                  rate (type "OE"), net of credit notes against them
 *   cdnr      9B   credit notes (sales returns) to registered buyers
 *   cdnur     9B   credit notes against B2C Large invoices
 *   nil       8    nil-rated, exempt and non-GST supplies
 *   hsn       12   HSN summary by code, unit and rate, split B2B / B2C
 *   doc_issue 13   number range per series (invoices, bills of supply, credit notes)
 * Not produced: exports and SEZ (exp, sez), reverse charge, e-commerce operator
 * tables and amendments — the books have no such entries. Cess is always 0.
 *
 * Amounts are rupees with 2 decimals, summed in paise first so nothing drifts.
 */
import { formatDate } from "../dates";
import type { Firm, Item, Paise, Party, UnitDef, Voucher } from "../types";
import { uqcFor } from "../units";
import { GSTIN_PATTERN } from "../validation";
import { billParty, gstr1, gstr1Table, inGstMonth, type Gstr1 } from "./gst";
import { calcCharge, calcLine } from "./invoice";
import { baseQty } from "./stock";
import { lineTaxType } from "./taxType";

/** Offline tool schema version written in the file. */
export const GSTR1_JSON_VERSION = "GST3.2.1";

export interface Gstr1ItemDetail {
  rt: number;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt: number;
}
export interface Gstr1JsonItem {
  num: number;
  itm_det: Gstr1ItemDetail;
}
export interface Gstr1HsnRow {
  num: number;
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
export type NilSupplyType = "INTRB2B" | "INTRAB2B" | "INTRB2C" | "INTRAB2C";

/** The portal file. Keys and order as the offline tool writes them. */
export interface Gstr1PortalJson {
  gstin: string;
  fp: string;
  version: string;
  hash: "hash";
  b2b?: {
    ctin: string;
    inv: {
      inum: string;
      idt: string;
      val: number;
      pos: string;
      rchrg: "N";
      inv_typ: "R";
      itms: Gstr1JsonItem[];
    }[];
  }[];
  b2cl?: {
    pos: string;
    inv: { inum: string; idt: string; val: number; itms: Gstr1JsonItem[] }[];
  }[];
  b2cs?: {
    sply_ty: "INTER" | "INTRA";
    pos: string;
    typ: "OE";
    rt: number;
    txval: number;
    iamt?: number;
    camt?: number;
    samt?: number;
    csamt: number;
  }[];
  cdnr?: {
    ctin: string;
    nt: {
      ntty: "C";
      nt_num: string;
      nt_dt: string;
      val: number;
      pos: string;
      rchrg: "N";
      inv_typ: "R";
      itms: Gstr1JsonItem[];
    }[];
  }[];
  cdnur?: {
    typ: "B2CL";
    ntty: "C";
    nt_num: string;
    nt_dt: string;
    val: number;
    pos: string;
    itms: Gstr1JsonItem[];
  }[];
  nil?: {
    inv: {
      sply_ty: NilSupplyType;
      nil_amt: number;
      expt_amt: number;
      ngsup_amt: number;
    }[];
  };
  hsn?: { hsn_b2b: Gstr1HsnRow[]; hsn_b2c: Gstr1HsnRow[] };
  doc_issue?: {
    doc_det: {
      doc_num: number;
      docs: {
        num: number;
        from: string;
        to: string;
        totnum: number;
        cancel: number;
        net_issue: number;
      }[];
    }[];
  };
}

export interface Gstr1Export {
  month: string;
  fileName: string;
  /** Things the portal is likely to refuse, to fix in the books before uploading. */
  warnings: string[];
  json: Gstr1PortalJson;
}

export class Gstr1JsonError extends Error {}

/** Paise → rupees with 2 decimals. */
const rs = (p: Paise) => Math.round(p) / 100;
/** Quantities: up to 2 decimals. */
const qty2 = (q: number) => Math.round(q * 100) / 100;

/** Table 13 document codes. */
const DOC_NUM = {
  "Tax invoices": 1,
  "Bills of supply": 1,
  "Credit notes": 5,
} as const;

/** Portal limits on invoice and note numbers. */
const DOC_NUMBER = /^[A-Za-z0-9/-]{1,16}$/;

interface RateHeads {
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
}

/** GST-charged lines and charges of one bill, by rate, with each tax head. */
export function billRateHeads(v: Voucher): Map<number, RateHeads> {
  const interState = !!v.interState;
  const byRate = new Map<number, RateHeads>();
  const add = (t: RateHeads, rate: number) => {
    const r = byRate.get(rate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += t.taxable;
    r.cgst += t.cgst;
    r.sgst += t.sgst;
    r.igst += t.igst;
    byRate.set(rate, r);
  };
  for (const line of v.lines ?? [])
    if (lineTaxType(line) === "taxable")
      add(calcLine(line, interState), line.gstRate);
  for (const c of v.charges ?? []) add(calcCharge(c, interState), c.gstRate);
  return byRate;
}

const heads = (h: RateHeads, interState: boolean) =>
  interState
    ? { iamt: rs(h.igst), csamt: 0 }
    : { camt: rs(h.cgst), samt: rs(h.sgst), csamt: 0 };

function items(v: Voucher): Gstr1JsonItem[] {
  return [...billRateHeads(v).entries()]
    .sort(([a], [b]) => a - b)
    .map(([rt, h], i) => ({
      num: i + 1,
      itm_det: { rt, txval: rs(h.taxable), ...heads(h, !!v.interState) },
    }));
}

export interface Gstr1JsonBooks {
  firm: Pick<Firm, "name" | "gstin" | "stateCode">;
  vouchers: Voucher[];
  parties: Party[];
  items: Item[];
  units?: UnitDef[];
}

/** "2026-09" → "092026" */
export const returnPeriod = (month: string) =>
  `${month.slice(5, 7)}${month.slice(0, 4)}`;

/**
 * The GSTR-1 upload file for one month. Throws `Gstr1JsonError` when the firm
 * has no valid GSTIN (the file can't be made); everything else is a warning.
 */
export function gstr1Json(books: Gstr1JsonBooks, month: string): Gstr1Export {
  if (!/^\d{4}-\d{2}$/.test(month))
    throw new Gstr1JsonError("Choose a month as YYYY-MM.");
  const gstin = (books.firm.gstin ?? "").toUpperCase();
  if (!GSTIN_PATTERN.test(gstin))
    throw new Gstr1JsonError(
      "Add the firm's GSTIN in Settings → Firm profile before downloading the GSTR-1 file.",
    );
  const firmState = books.firm.stateCode || gstin.slice(0, 2);
  const warnings = new Set<string>();
  const warn = (text: string) => warnings.add(text);
  const { vouchers, parties } = books;
  const working: Gstr1 = gstr1(
    vouchers,
    parties,
    books.items,
    month,
    books.units,
  );

  const checkNumber = (v: Voucher, kind: string) => {
    if (!DOC_NUMBER.test(v.number))
      warn(
        `${kind} ${v.number}: the portal takes at most 16 letters, digits, "/" or "-".`,
      );
  };
  const placeOf = (v: Voucher, party: Party | undefined): string => {
    const pos =
      party?.stateCode ||
      party?.gstin?.slice(0, 2) ||
      (v.interState ? "" : firmState);
    if (!/^\d{2}$/.test(pos))
      warn(
        `${v.number}: the buyer's state is missing, so the place of supply is blank.`,
      );
    else if (v.interState === (pos === firmState))
      warn(
        `${v.number}: ${v.interState ? "IGST was charged but the buyer is in the firm's state" : "CGST/SGST was charged but the buyer is in another state"}; the portal may refuse it.`,
      );
    return pos;
  };
  const checkCtin = (v: Voucher, party: Party) => {
    if (!GSTIN_PATTERN.test(party.gstin ?? ""))
      warn(`${v.number}: ${party.name}'s GSTIN ${party.gstin} is not valid.`);
  };

  // ---- Sales: B2B, B2C Large, B2C Small -----------------------------------
  const sales = vouchers
    .filter((v) => v.type === "sale" && inGstMonth(v, month))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    );
  const b2b = new Map<string, NonNullable<Gstr1PortalJson["b2b"]>[number]>();
  const b2cl = new Map<string, NonNullable<Gstr1PortalJson["b2cl"]>[number]>();
  const b2cs = new Map<
    string,
    { sply_ty: "INTER" | "INTRA"; pos: string; rt: number } & RateHeads
  >();
  const addB2cs = (v: Voucher, pos: string, sign: 1 | -1) => {
    const sply_ty = v.interState ? "INTER" : "INTRA";
    for (const [rt, h] of billRateHeads(v)) {
      const key = `${sply_ty}|${pos}|${rt}`;
      const row = b2cs.get(key) ?? {
        sply_ty,
        pos,
        rt,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
      };
      row.taxable += sign * h.taxable;
      row.cgst += sign * h.cgst;
      row.sgst += sign * h.sgst;
      row.igst += sign * h.igst;
      b2cs.set(key, row);
    }
  };

  for (const v of sales) {
    if (!billRateHeads(v).size) continue; // Bill of supply: table 8 only
    const party = billParty(v, parties);
    const table = gstr1Table(v, party);
    if (table !== "b2cs") checkNumber(v, "Invoice");
    if (table === "b2b" && party?.gstin) {
      checkCtin(v, party);
      const ctin = party.gstin.toUpperCase();
      const row = b2b.get(ctin) ?? { ctin, inv: [] };
      row.inv.push({
        inum: v.number,
        idt: formatDate(v.date),
        val: rs(v.amount),
        pos: placeOf(v, party),
        rchrg: "N",
        inv_typ: "R",
        itms: items(v),
      });
      b2b.set(ctin, row);
    } else if (table === "b2cl") {
      const pos = placeOf(v, party);
      const row = b2cl.get(pos) ?? { pos, inv: [] };
      row.inv.push({
        inum: v.number,
        idt: formatDate(v.date),
        val: rs(v.amount),
        itms: items(v),
      });
      b2cl.set(pos, row);
    } else addB2cs(v, placeOf(v, party), 1);
  }

  // ---- Credit notes: 9B, or netted into B2C Small ---------------------------
  const cdnr = new Map<string, NonNullable<Gstr1PortalJson["cdnr"]>[number]>();
  const cdnur: NonNullable<Gstr1PortalJson["cdnur"]> = [];
  const notes = vouchers
    .filter((v) => v.type === "credit-note" && inGstMonth(v, month))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    );
  for (const v of notes) {
    if (!billRateHeads(v).size) {
      warn(
        `Credit note ${v.number} has no GST-charged lines, so it is not in the file; adjust table 8 on the portal if needed.`,
      );
      continue;
    }
    const party = billParty(v, parties);
    const pos = placeOf(v, party);
    if (party?.gstin) {
      checkNumber(v, "Credit note");
      checkCtin(v, party);
      const ctin = party.gstin.toUpperCase();
      const row = cdnr.get(ctin) ?? { ctin, nt: [] };
      row.nt.push({
        ntty: "C",
        nt_num: v.number,
        nt_dt: formatDate(v.date),
        val: rs(v.amount),
        pos,
        rchrg: "N",
        inv_typ: "R",
        itms: items(v),
      });
      cdnr.set(ctin, row);
      continue;
    }
    const bill = vouchers.find((x) => x.id === v.againstId);
    const againstLarge =
      !!bill &&
      gstr1Table(bill, billParty(bill, parties)) === "b2cl" &&
      !!v.interState;
    if (againstLarge) {
      checkNumber(v, "Credit note");
      cdnur.push({
        typ: "B2CL",
        ntty: "C",
        nt_num: v.number,
        nt_dt: formatDate(v.date),
        val: rs(v.amount),
        pos,
        itms: items(v),
      });
    } else addB2cs(v, pos, -1);
  }

  // ---- Table 8 ---------------------------------------------------------------
  const NIL: Record<string, NilSupplyType> = {
    "inter-registered": "INTRB2B",
    "intra-registered": "INTRAB2B",
    "inter-unregistered": "INTRB2C",
    "intra-unregistered": "INTRAB2C",
  };
  const nil = working.noTax
    .filter((r) => r.nil || r.exempt || r.nonGst)
    .map((r) => ({
      sply_ty: NIL[r.row],
      nil_amt: rs(r.nil),
      expt_amt: rs(r.exempt),
      ngsup_amt: rs(r.nonGst),
    }));

  // ---- Table 12: HSN by code, unit and rate ---------------------------------
  type Hsn = Omit<Gstr1HsnRow, "num"> & { kind: "b2b" | "b2c" } & {
    paise: RateHeads;
  };
  const hsn = new Map<string, Hsn>();
  const addHsn = (
    kind: "b2b" | "b2c",
    code: string,
    desc: string,
    uqc: string,
    q: number,
    rt: number,
    t: RateHeads,
    sign: number,
  ) => {
    const service = code.startsWith("99");
    const unit = service ? "NA" : uqc;
    const key = `${kind}|${code}|${unit}|${rt}`;
    const row = hsn.get(key) ?? {
      kind,
      hsn_sc: code,
      desc: desc.slice(0, 30),
      uqc: unit,
      qty: 0,
      rt,
      txval: 0,
      iamt: 0,
      camt: 0,
      samt: 0,
      csamt: 0,
      paise: { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    };
    if (!service) row.qty += sign * q;
    row.paise.taxable += sign * t.taxable;
    row.paise.cgst += sign * t.cgst;
    row.paise.sgst += sign * t.sgst;
    row.paise.igst += sign * t.igst;
    hsn.set(key, row);
  };
  const missingHsn = new Set<string>();
  for (const v of [...sales, ...notes]) {
    const sign = v.type === "credit-note" ? -1 : 1;
    const kind = billParty(v, parties)?.gstin ? "b2b" : "b2c";
    for (const line of v.lines ?? []) {
      const type = lineTaxType(line);
      if (type === "nongst") continue;
      const item = (v.snapshot?.items ?? books.items).find(
        (i) => i.id === line.itemId,
      );
      const code = (item?.hsn ?? "").trim();
      if (!/^\d{4,8}$/.test(code)) missingHsn.add(item?.name ?? "An item");
      addHsn(
        kind,
        code,
        item?.name ?? "",
        uqcFor(item?.unit ?? "", v.snapshot?.units ?? books.units),
        baseQty(line),
        type === "taxable" ? line.gstRate : 0,
        calcLine(line, !!v.interState),
        sign,
      );
    }
    for (const c of v.charges ?? [])
      addHsn(
        kind,
        "9965",
        "Freight and transport",
        "NA",
        0,
        c.gstRate,
        calcCharge(c, !!v.interState),
        sign,
      );
  }
  for (const name of missingHsn)
    warn(`${name} has no valid HSN code (4 to 8 digits); add it to the item.`);
  const hsnRows = [...hsn.values()]
    .sort(
      (a, b) =>
        a.hsn_sc.localeCompare(b.hsn_sc) ||
        a.uqc.localeCompare(b.uqc) ||
        a.rt - b.rt,
    )
    .map(({ paise, kind, ...row }) => ({
      kind,
      row: {
        ...row,
        qty: qty2(row.qty),
        txval: rs(paise.taxable),
        iamt: rs(paise.igst),
        camt: rs(paise.cgst),
        samt: rs(paise.sgst),
      },
    }));
  const hsnOf = (kind: "b2b" | "b2c"): Gstr1HsnRow[] =>
    hsnRows
      .filter((r) => r.kind === kind)
      .map(({ row }, i) => ({
        num: i + 1,
        hsn_sc: row.hsn_sc,
        desc: row.desc,
        uqc: row.uqc,
        qty: row.qty,
        rt: row.rt,
        txval: row.txval,
        iamt: row.iamt,
        camt: row.camt,
        samt: row.samt,
        csamt: 0,
      }));

  // ---- Table 13 ----------------------------------------------------------------
  const docDet = new Map<
    number,
    NonNullable<Gstr1PortalJson["doc_issue"]>["doc_det"][number]
  >();
  for (const d of working.documents) {
    const doc_num = DOC_NUM[d.kind];
    const det = docDet.get(doc_num) ?? { doc_num, docs: [] };
    det.docs.push({
      num: det.docs.length + 1,
      from: d.from,
      to: d.to,
      totnum: d.total,
      cancel: d.cancelled,
      net_issue: d.total - d.cancelled,
    });
    docDet.set(doc_num, det);
  }

  // ---- Assemble ------------------------------------------------------------------
  const json: Gstr1PortalJson = {
    gstin,
    fp: returnPeriod(month),
    version: GSTR1_JSON_VERSION,
    hash: "hash",
  };
  if (b2b.size) json.b2b = [...b2b.values()];
  if (b2cl.size) json.b2cl = [...b2cl.values()];
  const b2csRows = [...b2cs.values()]
    .filter((r) => r.taxable || r.cgst || r.sgst || r.igst)
    .sort(
      (a, b) =>
        a.sply_ty.localeCompare(b.sply_ty) ||
        a.pos.localeCompare(b.pos) ||
        a.rt - b.rt,
    );
  for (const r of b2csRows)
    if (r.taxable < 0)
      warn(
        `B2C Small ${r.pos} at ${r.rt}%: returns are more than sales this month (taxable ₹${rs(r.taxable)}).`,
      );
  if (b2csRows.length)
    json.b2cs = b2csRows.map((r) => ({
      sply_ty: r.sply_ty,
      pos: r.pos,
      typ: "OE",
      rt: r.rt,
      txval: rs(r.taxable),
      ...heads(r, r.sply_ty === "INTER"),
    }));
  if (cdnr.size) json.cdnr = [...cdnr.values()];
  if (cdnur.length) json.cdnur = cdnur;
  if (nil.length) json.nil = { inv: nil };
  if (hsnRows.length)
    json.hsn = { hsn_b2b: hsnOf("b2b"), hsn_b2c: hsnOf("b2c") };
  if (docDet.size)
    json.doc_issue = {
      doc_det: [...docDet.values()].sort((a, b) => a.doc_num - b.doc_num),
    };

  return {
    month,
    fileName: `GSTR1_${gstin}_${json.fp}`,
    warnings: [...warnings],
    json,
  };
}
