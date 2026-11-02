/**
 * Printable HTML for a voucher: tax invoice, bill of supply, credit / debit note,
 * purchase bill, payment receipt or any other voucher.
 *
 * Pure function: the app turns the HTML into a PDF (expo-print), and the real API
 * can use the same function to render PDFs on the server.
 */
import {
  calcCharge,
  calcInvoice,
  calcLine,
  type LineTotals,
} from "../accounting/invoice";
import { voucherPostings } from "../accounting/postings";
import { lineQtyText } from "../accounting/stock";
import { docTypeLabel, lineTaxType, taxTypeLabel } from "../accounting/taxType";
import {
  billsCarryGst,
  COMPOSITION_DECLARATION,
  gstModeOf,
  NO_GST_NOTE,
  sideOf,
  voucherMode,
} from "../accounting/gstMode";
import { formatDate } from "../dates";
import { amountInWords, formatINR, thousandths } from "../money";
import { stateName } from "../states";
import type {
  InvoiceLine,
  Firm,
  InvoiceSettings,
  InvoiceTemplate,
  Item,
  Party,
  Voucher,
} from "../types";

export interface PrintInput {
  firm: Firm;
  voucher: Voucher;
  party?: Party;
  /** Items used on the voucher lines (for name, HSN and unit). */
  items: Item[];
  settings: InvoiceSettings;
  /** Name of the bank printed with the account details, e.g. "HDFC Bank". */
  bankName?: string;
  /** Cash/bank ledger of a receipt or payment. */
  ledgerName?: string;
  /** Credit/debit notes: the bill they were made against. */
  against?: { number: string; date: string };
  /** Receipts/payments: the bills the money was applied to. */
  allocatedTo?: { number: string; amount: number }[];
}

/**
 * Width (px) the page is laid out at: A4 is about 794 px wide at 96 dpi; thermal rolls about 300.
 * Phones show the page scaled down to fit, so tables never squeeze.
 */
export const PAGE_WIDTH: Record<InvoiceTemplate, number> = {
  classic: 800,
  modern: 800,
  compact: 340,
};

export interface Printable {
  /** e.g. "TAX INVOICE" */
  title: string;
  html: string;
  /** e.g. "SI-26-27-0042 Gupta Kirana Store.pdf" */
  fileName: string;
}

/** Escape text so names like "Agarwal & Sons" print correctly. */
const esc = (s: string | undefined | null) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inr = (p: number) => esc(formatINR(p));

/** Heading printed at the top of the document. */
export function printTitle(v: Voucher): string {
  switch (v.type) {
    case "sale":
      return docTypeLabel(v.docType ?? "tax-invoice").toUpperCase();
    case "purchase":
      return "PURCHASE BILL";
    case "credit-note":
      return "CREDIT NOTE";
    case "debit-note":
      return "DEBIT NOTE";
    case "receipt":
      return "PAYMENT RECEIPT";
    case "payment":
      return "PAYMENT VOUCHER";
    case "expense":
      return "EXPENSE VOUCHER";
    case "journal":
      return "JOURNAL VOUCHER";
    case "contra":
      return "CONTRA VOUCHER";
    case "estimate":
      return "ESTIMATE";
    case "sales-order":
      return "SALES ORDER";
    case "delivery-note":
      return "DELIVERY CHALLAN";
    case "purchase-order":
      return "PURCHASE ORDER";
  }
}

// ---------------------------------------------------------------------------
// Styles per template
// ---------------------------------------------------------------------------

const BASE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; font-size: 12px; line-height: 1.45; }
h1 { margin: 0; font-size: 20px; }
.muted { color: #555; }
.small { font-size: 10.5px; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.row { display: flex; justify-content: space-between; gap: 16px; }
.col { flex: 1; min-width: 0; }
.box { padding: 10px 12px; }
.title { font-weight: 700; letter-spacing: 0.08em; font-size: 14px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: 10.5px; }
th, td { padding: 6px 8px; vertical-align: top; }
.totals td { padding: 4px 8px; }
.grand td { font-weight: 700; font-size: 14px; }
.sign { text-align: right; margin-top: 36px; }
.foot { margin-top: 18px; text-align: center; font-size: 10px; color: #777; }
.tag { display: inline-block; border: 1px solid #000; border-radius: 999px; padding: 1px 8px; font-size: 10px; }
`;

const TEMPLATE_CSS: Record<InvoiceTemplate, string> = {
  // Boxed tables, like Tally
  classic: `
.sheet { border: 1px solid #000; }
.sec { border-bottom: 1px solid #000; }
.sec:last-child { border-bottom: 0; }
.items th, .items td, .tax th, .tax td { border: 1px solid #000; }
.items th, .tax th { background: #f2f2f2; }
.split > .col + .col { border-left: 1px solid #000; }
`,
  // Clean: black title band, hairlines only
  modern: `
.band { background: #000; color: #fff; padding: 10px 14px; border-radius: 10px; margin: 14px 0; }
.items th, .tax th { border-bottom: 1px solid #000; }
.items td, .tax td { border-bottom: 1px solid #e5e5e5; }
.sec { margin-bottom: 14px; }
.card { border: 1px solid #e5e5e5; border-radius: 12px; }
`,
  // Narrow, for 80 mm thermal printers
  compact: `
body { padding: 8px; font-size: 11px; }
.sheet { max-width: 300px; margin: 0 auto; }
.sec { border-bottom: 1px dashed #000; padding: 6px 0; text-align: center; }
.items td, .items th { padding: 3px 0; }
.items th { border-bottom: 1px dashed #000; }
.totals td { padding: 2px 0; }
h1 { font-size: 15px; }
`,
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function firmBlock(firm: Firm, compact: boolean) {
  const lines = [
    [firm.address, firm.city].filter(Boolean).join(", "),
    `${stateName(firm.stateCode)} (${firm.stateCode})`,
    [firm.phone && `Ph ${firm.phone}`, firm.email].filter(Boolean).join(" · "),
    firm.gstin ? `GSTIN ${firm.gstin}` : "",
    !compact && firm.pan ? `PAN ${firm.pan}` : "",
  ].filter(Boolean);
  return `<h1>${esc(firm.name)}</h1>${lines.map((l) => `<div class="small muted">${esc(l)}</div>`).join("")}`;
}

function partyBlock(
  v: Voucher,
  party: Party | undefined,
  label: string,
  /** Firms without GST don't print the party's GST status. */
  showGstin = true,
) {
  if (!party) return "";
  const gst = showGstin
    ? party.gstin
      ? `GSTIN ${esc(party.gstin)}`
      : "Unregistered"
    : "";
  return `
<div class="small muted">${esc(label)}</div>
<div style="font-weight:600;font-size:13px">${esc(party.name)}</div>
<div class="small">${esc([party.city, `${stateName(party.stateCode)} (${party.stateCode})`].filter(Boolean).join(", "))}</div>
<div class="small">${[gst, party.phone ? `Ph ${esc(party.phone)}` : ""].filter(Boolean).join(" · ")}</div>`;
}

function metaRows(rows: [string, string | undefined][]) {
  return rows
    .filter(([, value]) => value)
    .map(
      ([k, value]) =>
        `<div class="row small"><span class="muted">${esc(k)}</span><span>${esc(value)}</span></div>`,
    )
    .join("");
}

// ---------------------------------------------------------------------------
// Bills and returns
// ---------------------------------------------------------------------------

/**
 * Lines as the customer should see them. A sale line that drew on several stock
 * lots is saved as one line per lot; adjacent lines with the same item, unit,
 * price, discount rate and tax print as one row with their amounts added up.
 */
export function printRows(lines: InvoiceLine[], interState: boolean) {
  const rows: { line: InvoiceLine; lt: LineTotals }[] = [];
  const same = (a: InvoiceLine, b: InvoiceLine) =>
    a.itemId === b.itemId &&
    a.rate === b.rate &&
    a.gstRate === b.gstRate &&
    a.taxType === b.taxType &&
    a.discountPercent === b.discountPercent &&
    (a.discountAmount === undefined) === (b.discountAmount === undefined) &&
    a.per?.unit === b.per?.unit &&
    a.per?.factor === b.per?.factor;
  for (const line of lines) {
    const lt = calcLine(line, interState);
    const last = rows[rows.length - 1];
    if (last && same(last.line, line)) {
      last.line = {
        ...last.line,
        qty: (thousandths(last.line.qty) + thousandths(line.qty)) / 1000,
      };
      for (const key of Object.keys(lt) as (keyof LineTotals)[])
        last.lt = { ...last.lt, [key]: last.lt[key] + lt[key] };
    } else rows.push({ line, lt });
  }
  return rows;
}

function billHtml(input: PrintInput, title: string): string {
  const { firm, voucher: v, party, items, settings } = input;
  const template = settings.template;
  const compact = template === "compact";
  const interState = !!v.interState;
  const totals = calcInvoice({
    lines: v.lines ?? [],
    charges: v.charges,
    interState,
  });
  const item = (id: string) => items.find((i) => i.id === id);
  // GST columns only when this bill carries GST (not on composition sales or without GST)
  const mode = voucherMode(v);
  const showGst =
    v.bookScope !== "nongst" && billsCarryGst(mode, sideOf(v.type) ?? "sale");
  const showHsn = mode !== "off";
  const isSale = v.type === "sale";
  const isNote = v.type === "credit-note" || v.type === "debit-note";
  const isQuote = v.type === "estimate" || v.type === "sales-order";
  const isChallan = v.type === "delivery-note";
  const partyLabel =
    v.type === "purchase" ||
    v.type === "debit-note" ||
    v.type === "purchase-order"
      ? "Supplier"
      : isChallan
        ? "Deliver to"
        : "Bill to";
  const numberLabel: Partial<Record<Voucher["type"], string>> = {
    "credit-note": "Note no.",
    "debit-note": "Note no.",
    purchase: "Voucher no.",
    estimate: "Estimate no.",
    "sales-order": "Order no.",
    "purchase-order": "PO no.",
    "delivery-note": "Challan no.",
  };

  const meta = metaRows([
    ["Delivery by", v.delivery?.name],
    ["Vehicle", v.delivery?.vehicle],
    ["Delivery reference", v.delivery?.reference],
    ["Delivery phone", v.delivery?.printPhone ? v.delivery.phone : undefined],
    [numberLabel[v.type] ?? "Invoice no.", v.number],
    ["Date", formatDate(v.date)],
    ["Supplier invoice", v.supplierInvoiceNo],
    [
      "Against",
      input.against
        ? `${input.against.number} dated ${formatDate(input.against.date)}`
        : undefined,
    ],
    ["Reason", v.noteReason],
    ["Valid until", v.validUntil ? formatDate(v.validUntil) : undefined],
    ["Due date", isSale && v.dueDate ? formatDate(v.dueDate) : undefined],
    [
      "Place of supply",
      party && mode === "regular"
        ? `${stateName(party.stateCode)} (${party.stateCode})`
        : undefined,
    ],
  ]);

  // Item rows (one row per item and price, even when the stock came from several lots)
  const rows = printRows(v.lines ?? [], interState)
    .map(({ line, lt }, i) => {
      const it = item(line.itemId);
      const q = lineQtyText(line, it?.unit ?? "");
      const qty = `${esc(q.main)}${q.base ? `<div class="small muted">${esc(q.base)}</div>` : ""}`;
      const type = lineTaxType(line);
      const gst =
        type === "taxable" ? `${line.gstRate}%` : esc(taxTypeLabel(type));
      if (compact)
        return `<tr><td>${esc(it?.name)}<div class="small muted">${qty} × ${inr(line.rate)}${lt.discount ? ` − ${inr(lt.discount)}` : ""}${showGst ? ` · ${gst}` : ""}</div></td><td class="num">${inr(lt.total)}</td></tr>`;
      return `<tr>
<td class="num">${i + 1}</td>
<td>${esc(it?.name)}</td>
${showHsn ? `<td>${esc(it?.hsn || "—")}</td>` : ""}
<td class="num">${qty}</td>
<td class="num">${inr(line.rate)}</td>
<td class="num">${lt.discount ? inr(lt.discount) : "—"}</td>
${showGst ? `<td class="num">${inr(lt.taxable)}</td><td class="num">${gst}</td>` : ""}
<td class="num">${inr(lt.total)}</td>
</tr>`;
    })
    .join("");
  const chargeRows = (v.charges ?? [])
    .map((c) =>
      compact
        ? `<tr><td>${esc(c.name)}${showGst ? ` · ${c.gstRate}%` : ""}</td><td class="num">${inr(c.amount)}</td></tr>`
        : showGst
          ? `<tr><td></td><td colspan="${showHsn ? 5 : 4}">${esc(c.name)}</td><td class="num">${inr(c.amount)}</td><td class="num">${c.gstRate}%</td><td class="num">${inr(calcCharge(c, interState).total)}</td></tr>`
          : `<tr><td></td><td colspan="${showHsn ? 5 : 4}">${esc(c.name)}</td><td class="num">${inr(c.amount)}</td></tr>`,
    )
    .join("");
  const itemsTable = compact
    ? `<table class="items"><tr><th>Item</th><th class="num">Amount</th></tr>${rows}${chargeRows}</table>`
    : `<table class="items"><tr><th class="num">#</th><th>Item</th>${showHsn ? "<th>HSN</th>" : ""}<th class="num">Qty</th><th class="num">Rate</th><th class="num">Disc</th>${showGst ? `<th class="num">Taxable</th><th class="num">GST</th>` : ""}<th class="num">Amount</th></tr>${rows}${chargeRows}</table>`;

  // Totals
  const taxRows = interState
    ? `<tr><td>IGST</td><td class="num">${inr(totals.igst)}</td></tr>`
    : `<tr><td>CGST</td><td class="num">${inr(totals.cgst)}</td></tr><tr><td>SGST</td><td class="num">${inr(totals.sgst)}</td></tr>`;
  const totalsTable = `<table class="totals">
<tr><td>${showGst ? "Taxable value" : "Sub total"}</td><td class="num">${inr(totals.taxable)}</td></tr>
${totals.tax ? taxRows : ""}
${totals.roundOff ? `<tr><td>Round off</td><td class="num">${inr(totals.roundOff)}</td></tr>` : ""}
<tr class="grand"><td>Total</td><td class="num">${inr(totals.grandTotal)}</td></tr>
</table>
<div class="small" style="margin-top:4px"><b>${esc(amountInWords(totals.grandTotal))}</b></div>`;

  // Tax breakup by rate (not on compact)
  const rates = totals.byRate.filter((r) => r.rate > 0);
  const taxBreakup =
    !compact && rates.length
      ? `<table class="tax"><tr><th>GST rate</th><th class="num">Taxable</th>${interState ? `<th class="num">IGST</th>` : `<th class="num">CGST</th><th class="num">SGST</th>`}<th class="num">Total tax</th></tr>
${rates
  .map(
    (r) =>
      `<tr><td>${r.rate}%</td><td class="num">${inr(r.taxable)}</td>${interState ? `<td class="num">${inr(r.igst)}</td>` : `<td class="num">${inr(r.cgst)}</td><td class="num">${inr(r.sgst)}</td>`}<td class="num">${inr(r.cgst + r.sgst + r.igst)}</td></tr>`,
  )
  .join("")}</table>`
      : "";

  const sideIsSale = sideOf(v.type) === "sale";
  const supplyNote =
    mode === "composition" && sideIsSale && !isQuote && !isChallan
      ? `<div class="small"><b>${esc(COMPOSITION_DECLARATION)}</b></div>`
      : mode === "off" && sideIsSale && !isChallan
        ? `<div class="small muted">${esc(NO_GST_NOTE)}</div>`
        : v.type === "sale" && v.docType === "bill-of-supply"
          ? `<div class="small muted">Goods on this bill are nil-rated, exempt or outside GST, so no GST is charged.</div>`
          : isChallan
            ? `<div class="small muted">Delivery challan for moving goods. Not a tax invoice; the invoice follows.</div>`
            : isQuote
              ? `<div class="small muted">This is not a tax invoice.</div>`
              : "";

  const bank = settings.bankAccount;
  const bankBlock =
    (isSale || v.type === "estimate") && settings.showBankDetails && bank
      ? `<div class="small"><b>Bank details</b><br/>${esc(input.bankName ?? "")}<br/>A/c ${esc(bank.accountName)} · ${esc(bank.accountNumber)}<br/>IFSC ${esc(bank.ifsc)}${bank.upiId ? `<br/>UPI ${esc(bank.upiId)}` : ""}</div>`
      : "";
  const terms =
    (isSale || isQuote) && settings.terms
      ? `<div class="small"><b>Terms</b><br/>${esc(settings.terms)}</div>`
      : "";
  const sign = `<div class="sign small">For <b>${esc(firm.name)}</b><br/><br/><br/>Authorised signatory</div>`;
  const copyTag =
    isSale || isNote ? `<span class="tag">Original for recipient</span>` : "";

  if (compact) {
    return `<div class="sheet">
<div class="sec">${firmBlock(firm, true)}</div>
<div class="sec"><div class="title">${esc(title)}</div>${meta}</div>
<div class="sec" style="text-align:left">${partyBlock(v, party, partyLabel, showHsn)}</div>
<div class="sec">${itemsTable}</div>
<div class="sec">${totalsTable}${supplyNote}</div>
${bankBlock || terms ? `<div class="sec" style="text-align:left">${bankBlock}${terms ? `<br/>${terms}` : ""}</div>` : ""}
<div class="foot">Thank you · Made with Hisaab</div>
</div>`;
  }

  if (template === "modern") {
    return `<div class="sheet">
<div class="row sec"><div class="col">${firmBlock(firm, false)}</div><div style="text-align:right">${copyTag}</div></div>
<div class="band row"><span class="title">${esc(title)}</span><span>${esc(v.number)}</span></div>
<div class="row sec"><div class="col card box">${partyBlock(v, party, partyLabel, showHsn)}</div><div class="col card box">${meta}</div></div>
<div class="sec">${itemsTable}</div>
<div class="row sec"><div class="col">${taxBreakup}${supplyNote}</div><div class="col">${totalsTable}</div></div>
<div class="row sec"><div class="col">${bankBlock}</div><div class="col">${terms}</div></div>
${sign}
<div class="foot">Made with Hisaab</div>
</div>`;
  }

  // classic
  return `<div class="sheet">
<div class="sec box row"><div class="col">${firmBlock(firm, false)}</div><div style="text-align:right"><div class="title">${esc(title)}</div>${copyTag}</div></div>
<div class="sec row split"><div class="col box">${partyBlock(v, party, partyLabel, showHsn)}</div><div class="col box">${meta}</div></div>
<div class="sec">${itemsTable}</div>
<div class="sec row split"><div class="col box">${taxBreakup}${supplyNote}</div><div class="col box">${totalsTable}</div></div>
${bankBlock || terms ? `<div class="sec row split"><div class="col box">${bankBlock}</div><div class="col box">${terms}</div></div>` : ""}
<div class="box">${sign}</div>
</div>
<div class="foot">Made with Hisaab</div>`;
}

// ---------------------------------------------------------------------------
// Receipts, payments and other vouchers
// ---------------------------------------------------------------------------

function moneyHtml(input: PrintInput, title: string): string {
  const { firm, voucher: v, party } = input;
  const compact = input.settings.template === "compact";
  const isReceipt = v.type === "receipt";
  const meta = metaRows([
    ["No.", v.number],
    ["Date", formatDate(v.date)],
    ["Mode", v.mode ? v.mode.toUpperCase() : undefined],
    [isReceipt ? "Deposited to" : "Paid from", input.ledgerName],
    ["Reference", v.reference],
  ]);
  const against = (input.allocatedTo ?? [])
    .map(
      (a) =>
        `<tr><td>${esc(a.number)}</td><td class="num">${inr(a.amount)}</td></tr>`,
    )
    .join("");
  const tds = v.tds
    ? `<tr><td>TDS ${esc(v.tds.section)} @ ${v.tds.rate}% kept back</td><td class="num">${inr(v.tds.amount)}</td></tr>`
    : "";
  return `<div class="sheet">
<div class="sec box">${firmBlock(firm, compact)}</div>
<div class="sec box row"><div class="col">${partyBlock(v, party, isReceipt ? "Received from" : "Paid to", gstModeOf(firm) !== "off")}</div><div class="col"><div class="title">${esc(title)}</div>${meta}</div></div>
<div class="sec box">
<div class="small muted">Amount</div>
<div style="font-size:22px;font-weight:700">${inr(v.amount)}</div>
<div class="small"><b>${esc(amountInWords(v.amount))}</b></div>
</div>
${against || tds ? `<div class="sec box"><table class="totals"><tr><th>Against bill</th><th class="num">Amount</th></tr>${against}${tds}</table></div>` : ""}
${v.narration ? `<div class="sec box small">${esc(v.narration)}</div>` : ""}
<div class="box">${`<div class="sign small">For <b>${esc(firm.name)}</b><br/><br/><br/>Authorised signatory</div>`}</div>
</div>
<div class="foot">Made with Hisaab</div>`;
}

function voucherOnlyHtml(input: PrintInput, title: string): string {
  const { firm, voucher: v } = input;
  const rows = voucherPostings(v, { ledger: input.ledgerName })
    .map(
      (p) =>
        `<tr><td>${esc(p.ledger)}</td><td class="num">${p.debit ? inr(p.debit) : ""}</td><td class="num">${p.credit ? inr(p.credit) : ""}</td></tr>`,
    )
    .join("");
  return `<div class="sheet">
<div class="sec box">${firmBlock(firm, false)}</div>
<div class="sec box"><div class="title">${esc(title)}</div>${metaRows([
    ["No.", v.number],
    ["Date", formatDate(v.date)],
  ])}</div>
<div class="sec box"><table class="items"><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${rows}</table></div>
${v.narration ? `<div class="sec box small">${esc(v.narration)}</div>` : ""}
</div>
<div class="foot">Made with Hisaab</div>`;
}

/** Build the printable HTML for any voucher. */
export function voucherHtml(input: PrintInput): Printable {
  const v = input.voucher;
  if (v.snapshot) {
    const { firm, party, items, settings, bankName } = v.snapshot;
    // Layout may change at print time; the issued business details may not.
    input = {
      ...input,
      firm,
      party,
      items,
      bankName,
      settings: { ...settings, template: input.settings.template },
    };
  }
  const title = printTitle(v);
  const body =
    v.type === "sale" ||
    v.type === "purchase" ||
    v.type === "credit-note" ||
    v.type === "debit-note" ||
    v.type === "estimate" ||
    v.type === "sales-order" ||
    v.type === "delivery-note" ||
    v.type === "purchase-order"
      ? billHtml(input, title)
      : v.type === "receipt" || v.type === "payment"
        ? moneyHtml(input, title)
        : voucherOnlyHtml(input, title);
  const cancelled =
    v.status === "cancelled"
      ? `<div style="position:fixed;top:40%;left:0;right:0;text-align:center;font-size:64px;font-weight:800;color:rgba(185,28,28,0.18);transform:rotate(-20deg)">CANCELLED</div>`
      : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${PAGE_WIDTH[input.settings.template]}"/><title>${esc(title)} ${esc(v.number)}</title><style>${BASE_CSS}${TEMPLATE_CSS[input.settings.template]}</style></head><body>${cancelled}${body}</body></html>`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return {
    title,
    html,
    fileName: `${safe(v.number)}${input.party ? ` ${safe(input.party.name)}` : ""}.pdf`,
  };
}
