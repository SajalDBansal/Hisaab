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
import { CHALLAN_TYPE_LABELS } from "../accounting/challans";
import { udyamLabel } from "../businessProfile";
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
import {
  formatCustomValue,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldValues,
} from "../customFields";
import type {
  ExtraCharge,
  InvoiceLine,
  Firm,
  InvoiceSettings,
  InvoiceTemplate,
  Item,
  Party,
  PrintLayout,
  Voucher,
} from "../types";
import { WALK_IN_PARTY_NAME } from "../books/base";
import { qrSvg, upiPayLink, type BillPayment } from "./upi";

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
  /** The firm's custom field definitions; those marked "print" are printed (doc 37, T07). */
  customFields?: CustomFieldDef[];
  /** Firm logo and signatory's signature as data:image URIs (doc 37, T16). */
  branding?: { logo?: string | null; signature?: string | null };
  /** Layout chosen at print time; "compact-58" is the compact layout on a 58 mm roll. */
  layout?: PrintLayout;
  /** Sales: received so far and still due, for the paid rows and the UPI QR (doc 37, T18). */
  payment?: BillPayment;
}

/** Only PNG or JPEG data URIs reach the page; anything else is dropped. */
const safeImage = (uri?: string | null) =>
  uri && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : "";

function signBlock(firmName: string, signature?: string | null) {
  const image = safeImage(signature);
  return `<div class="sign small">For <b>${esc(firmName)}</b><br/>${image ? `<img src="${image}" alt="" style="max-height:48px;max-width:160px;display:block;margin:4px 0 2px auto"/>` : "<br/><br/>"}Authorised signatory</div>`;
}

/** [label, value] pairs of a record's custom fields marked for printing. */
function printedFields(
  defs: CustomFieldDef[] | undefined,
  entity: CustomFieldEntity,
  values: CustomFieldValues | undefined,
): [string, string][] {
  return (defs ?? [])
    .filter(
      (d) => d.entity === entity && d.print && values?.[d.key] !== undefined,
    )
    .sort((a, b) => a.position - b.position)
    .map((d) => [d.name, formatCustomValue(values?.[d.key])]);
}

/**
 * Width (px) the page is laid out at: A4 is about 794 px wide at 96 dpi; thermal rolls about 300.
 * Phones show the page scaled down to fit, so tables never squeeze.
 */
export const PAGE_WIDTH: Record<PrintLayout, number> = {
  classic: 800,
  modern: 800,
  compact: 340,
  "compact-58": 220,
};

/** Thermal roll a layout prints on, for the PDF page size; none for A4. */
export const ROLL_WIDTH: Partial<Record<PrintLayout, "80mm" | "58mm">> = {
  compact: "80mm",
  "compact-58": "58mm",
};

/** The layout a retail bill opens in (doc 37, T02): the firm's thermal roll. */
export const retailLayout = (settings: Pick<InvoiceSettings, "retailPaper">) =>
  settings.retailPaper === "58"
    ? ("compact-58" as const)
    : ("compact" as const);

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
    case "proforma":
      return "PROFORMA INVOICE";
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

// 58 mm rolls print about 48 mm wide: smaller type, tighter rows.
const NARROW_CSS = `
body { padding: 4px; font-size: 10px; }
.sheet { max-width: 48mm; }
h1 { font-size: 13px; }
.small { font-size: 9.5px; }
.grand td { font-size: 12px; }
`;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function firmBlock(firm: Firm, compact: boolean, logo?: string | null) {
  const image = safeImage(logo);
  const lines = [
    [firm.address, firm.city].filter(Boolean).join(", "),
    `${stateName(firm.stateCode)} (${firm.stateCode})`,
    [firm.phone && `Ph ${firm.phone}`, firm.email, !compact && firm.website]
      .filter(Boolean)
      .join(" · "),
    firm.gstin ? `GSTIN ${firm.gstin}` : "",
    // Statutory numbers (doc 37, T61): food and drug licences go on every
    // bill (FSSAI and drug rules); CIN, PAN and Udyam on full-size bills.
    !compact
      ? [firm.pan && `PAN ${firm.pan}`, firm.cin && `CIN ${firm.cin}`]
          .filter(Boolean)
          .join(" · ")
      : "",
    [
      firm.fssai && `FSSAI Lic. No. ${firm.fssai}`,
      firm.drugLicence && `D.L. No. ${firm.drugLicence}`,
    ]
      .filter(Boolean)
      .join(" · "),
    !compact && firm.msmeType && firm.udyamNumber
      ? `Udyam Reg. No. ${udyamLabel(firm)}`
      : "",
  ].filter(Boolean);
  return `${image ? `<img src="${image}" alt="" style="max-height:${compact ? 40 : 64}px;max-width:${compact ? 120 : 200}px;display:block;margin-bottom:4px"/>` : ""}<h1>${esc(firm.name)}</h1>${lines.map((l) => `<div class="small muted">${esc(l)}</div>`).join("")}`;
}

function partyBlock(
  v: Voucher,
  party: Party | undefined,
  label: string,
  /** Firms without GST don't print the party's GST status. */
  showGstin = true,
  /** The party's custom fields marked for printing. */
  extra: [string, string][] = [],
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
<div class="small">${[gst, party.phone ? `Ph ${esc(party.phone)}` : ""].filter(Boolean).join(" · ")}</div>${extra.map(([k, value]) => `<div class="small">${esc(k)}: ${esc(value)}</div>`).join("")}`;
}

/** A retail bill (doc 37, T02): the buyer's name and phone when given, else "Cash customer". */
function retailPartyBlock(v: Voucher, party: Party | undefined, label: string) {
  const walkIn =
    !party ||
    party.name.trim().toLowerCase() === WALK_IN_PARTY_NAME.toLowerCase();
  const name = v.retail?.name || (walkIn ? WALK_IN_PARTY_NAME : party.name);
  const phone = v.retail?.phone || (walkIn ? "" : party?.phone);
  return `
<div class="small muted">${esc(label)}</div>
<div style="font-weight:600;font-size:13px">${esc(name)}</div>${phone ? `<div class="small">Ph ${esc(phone)}</div>` : ""}${!walkIn && party?.gstin ? `<div class="small">GSTIN ${esc(party.gstin)}</div>` : ""}`;
}

/** "Scan to pay" UPI QR for the amount still due (doc 37, T18). */
function upiBlock(input: PrintInput, sizePx: number) {
  const v = input.voucher;
  const upi = input.settings.upiQr;
  const due = input.payment?.due ?? v.amount;
  if (!upi || v.type !== "sale" || v.status !== "posted" || due <= 0) return "";
  const link = upiPayLink(upi, due, v.number);
  return `<div class="upi" style="text-align:center;margin:6px 0"><div style="display:inline-block">${qrSvg(link, sizePx)}</div><div class="small"><b>Scan to pay ${inr(due)}</b><br/>UPI ${esc(upi.upiId)}</div></div>`;
}

const MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank: "Bank",
  cheque: "Cheque",
  card: "Card",
};

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
    !a.billDiscountShare === !b.billDiscountShare &&
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
  const narrow = input.layout === "compact-58";
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
  const isQuote =
    v.type === "estimate" || v.type === "proforma" || v.type === "sales-order";
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
    proforma: "Proforma no.",
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
    // CGST Rule 55: the challan says why the goods move (doc 37, T04).
    [
      "Purpose",
      isChallan && v.challanType
        ? CHALLAN_TYPE_LABELS[v.challanType]
        : undefined,
    ],
    ["Supplier invoice", v.supplierInvoiceNo],
    [
      "Against",
      input.against
        ? `${input.against.number} dated ${formatDate(input.against.date)}`
        : undefined,
    ],
    ["Reason", v.noteReason],
    ["Valid until", v.validUntil ? formatDate(v.validUntil) : undefined],
    [
      "Due date",
      isSale && v.dueDate && !v.retail ? formatDate(v.dueDate) : undefined,
    ],
    [
      "Place of supply",
      party && mode === "regular"
        ? `${stateName(party.stateCode)} (${party.stateCode})`
        : undefined,
    ],
    ...printedFields(input.customFields, "voucher", v.customFields),
  ]);
  const partyExtra = printedFields(
    input.customFields,
    "party",
    party?.customFields,
  );
  const itemExtra = (it: Item | undefined) => {
    const pairs = printedFields(input.customFields, "item", it?.customFields);
    return pairs.length
      ? `<div class="small muted">${pairs.map(([k, value]) => `${esc(k)}: ${esc(value)}`).join(" · ")}</div>`
      : "";
  };

  // Item rows (one row per item and price, even when the stock came from several lots)
  const rows = printRows(v.lines ?? [], interState)
    .map(({ line, lt }, i) => {
      const it = item(line.itemId);
      const q = lineQtyText(line, it?.unit ?? "");
      const qty = `${esc(q.main)}${q.base ? `<div class="small muted">${esc(q.base)}</div>` : ""}`;
      const type = lineTaxType(line);
      const gst =
        type === "taxable" ? `${line.gstRate}%` : esc(taxTypeLabel(type));
      // The line's own discount plus its share of the subtotal discount (doc 37, T09).
      const disc = lt.discount + lt.billDiscount;
      if (compact)
        return `<tr><td>${esc(it?.name)}${itemExtra(it)}<div class="small muted">${qty} × ${inr(line.rate)}${disc ? ` − ${inr(disc)}` : ""}${showGst ? ` · ${gst}` : ""}</div></td><td class="num">${inr(lt.total)}</td></tr>`;
      return `<tr>
<td class="num">${i + 1}</td>
<td>${esc(it?.name)}${itemExtra(it)}</td>
${showHsn ? `<td>${esc(it?.hsn || "—")}</td>` : ""}
<td class="num">${qty}</td>
<td class="num">${inr(line.rate)}</td>
<td class="num">${disc ? inr(disc) : "—"}</td>
${showGst ? `<td class="num">${inr(lt.taxable)}</td><td class="num">${gst}</td>` : ""}
<td class="num">${inr(lt.total)}</td>
</tr>`;
    })
    .join("");
  // Exempt and non-GST charge heads print their treatment instead of a rate.
  const chargeGst = (c: ExtraCharge) =>
    c.taxType && c.taxType !== "taxable"
      ? esc(taxTypeLabel(c.taxType))
      : `${c.gstRate}%`;
  const chargeRows = (v.charges ?? [])
    .map((c) =>
      compact
        ? `<tr><td>${esc(c.name)}${showGst ? ` · ${chargeGst(c)}` : ""}</td><td class="num">${inr(c.amount)}</td></tr>`
        : showGst
          ? `<tr><td></td><td colspan="${showHsn ? 5 : 4}">${esc(c.name)}</td><td class="num">${inr(c.amount)}</td><td class="num">${chargeGst(c)}</td><td class="num">${inr(calcCharge(c, interState).total)}</td></tr>`
          : `<tr><td></td><td colspan="${showHsn ? 5 : 4}">${esc(c.name)}</td><td class="num">${inr(c.amount)}</td></tr>`,
    )
    .join("");
  const itemsTable = compact
    ? `<table class="items"><tr><th>Item</th><th class="num">Amount</th></tr>${rows}${chargeRows}</table>`
    : `<table class="items"><tr><th class="num">#</th><th>Item</th>${showHsn ? "<th>HSN</th>" : ""}<th class="num">Qty</th><th class="num">Rate</th><th class="num">Disc</th>${showGst ? `<th class="num">Taxable</th><th class="num">GST</th>` : ""}<th class="num">Amount</th></tr>${rows}${chargeRows}</table>`;

  // Paid now and balance (retail bills are paid in full, doc 37, T02)
  const paid = input.payment;
  const paidModes = (paid?.modes ?? [])
    .map((m) => MODE_LABEL[m] ?? m)
    .join(", ");
  const paidRows =
    isSale && paid && paid.received > 0
      ? `<table class="totals"><tr><td>Received${paidModes ? ` (${esc(paidModes)})` : ""}</td><td class="num">${inr(paid.received)}</td></tr>${paid.due > 0 ? `<tr><td><b>Balance due</b></td><td class="num"><b>${inr(paid.due)}</b></td></tr>` : ""}</table>`
      : "";
  const upi = upiBlock(input, narrow ? 110 : compact ? 130 : 104);

  // Totals
  const taxRows = interState
    ? `<tr><td>IGST</td><td class="num">${inr(totals.igst)}</td></tr>`
    : `<tr><td>CGST</td><td class="num">${inr(totals.cgst)}</td></tr><tr><td>SGST</td><td class="num">${inr(totals.sgst)}</td></tr>`;
  const discountRows = totals.billDiscount
    ? `<tr><td>Sub total</td><td class="num">${inr(totals.taxable + totals.billDiscount)}</td></tr>
<tr><td>Discount${v.billDiscount?.percent ? ` (${v.billDiscount.percent}%)` : ""}</td><td class="num">−${inr(totals.billDiscount)}</td></tr>`
    : "";
  const totalsTable = `<table class="totals">
${discountRows}
<tr><td>${showGst ? "Taxable value" : totals.billDiscount ? "After discount" : "Sub total"}</td><td class="num">${inr(totals.taxable)}</td></tr>
${totals.tax ? taxRows : ""}
${totals.roundOff ? `<tr><td>Round off</td><td class="num">${inr(totals.roundOff)}</td></tr>` : ""}
<tr class="grand"><td>Total</td><td class="num">${inr(totals.grandTotal)}</td></tr>
</table>
${paidRows}
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
    (isSale || v.type === "estimate" || v.type === "proforma") &&
    settings.showBankDetails &&
    bank
      ? `<div class="small"><b>Bank details</b><br/>${esc(input.bankName ?? "")}<br/>A/c ${esc(bank.accountName)} · ${esc(bank.accountNumber)}<br/>IFSC ${esc(bank.ifsc)}${bank.upiId ? `<br/>UPI ${esc(bank.upiId)}` : ""}</div>`
      : "";
  const terms =
    (isSale || isQuote) && settings.terms
      ? `<div class="small"><b>Terms</b><br/>${esc(settings.terms)}</div>`
      : "";
  const sign = signBlock(firm.name, input.branding?.signature);
  const partyHtml = v.retail
    ? retailPartyBlock(v, party, partyLabel)
    : partyBlock(v, party, partyLabel, showHsn, partyExtra);
  const copyTag =
    isSale || isNote ? `<span class="tag">Original for recipient</span>` : "";

  if (compact) {
    return `<div class="sheet">
<div class="sec">${firmBlock(firm, true, input.branding?.logo)}</div>
<div class="sec"><div class="title">${esc(title)}</div>${meta}</div>
<div class="sec" style="text-align:left">${partyHtml}</div>
<div class="sec">${itemsTable}</div>
<div class="sec">${totalsTable}${supplyNote}</div>
${upi ? `<div class="sec">${upi}</div>` : ""}
${bankBlock || terms ? `<div class="sec" style="text-align:left">${bankBlock}${terms ? `<br/>${terms}` : ""}</div>` : ""}
<div class="foot">Thank you · Made with Hisaab</div>
</div>`;
  }

  if (template === "modern") {
    return `<div class="sheet">
<div class="row sec"><div class="col">${firmBlock(firm, false, input.branding?.logo)}</div><div style="text-align:right">${copyTag}</div></div>
<div class="band row"><span class="title">${esc(title)}</span><span>${esc(v.number)}</span></div>
<div class="row sec"><div class="col card box">${partyHtml}</div><div class="col card box">${meta}</div></div>
<div class="sec">${itemsTable}</div>
<div class="row sec"><div class="col">${taxBreakup}${supplyNote}</div><div class="col">${totalsTable}</div></div>
<div class="row sec"><div class="col">${bankBlock}${upi}</div><div class="col">${terms}</div></div>
${sign}
<div class="foot">Made with Hisaab</div>
</div>`;
  }

  // classic
  return `<div class="sheet">
<div class="sec box row"><div class="col">${firmBlock(firm, false, input.branding?.logo)}</div><div style="text-align:right"><div class="title">${esc(title)}</div>${copyTag}</div></div>
<div class="sec row split"><div class="col box">${partyHtml}</div><div class="col box">${meta}</div></div>
<div class="sec">${itemsTable}</div>
<div class="sec row split"><div class="col box">${taxBreakup}${supplyNote}</div><div class="col box">${totalsTable}</div></div>
${bankBlock || terms || upi ? `<div class="sec row split"><div class="col box">${bankBlock}${upi}</div><div class="col box">${terms}</div></div>` : ""}
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
<div class="sec box">${firmBlock(firm, compact, input.branding?.logo)}</div>
<div class="sec box row"><div class="col">${partyBlock(v, party, isReceipt ? "Received from" : "Paid to", gstModeOf(firm) !== "off")}</div><div class="col"><div class="title">${esc(title)}</div>${meta}</div></div>
<div class="sec box">
<div class="small muted">Amount</div>
<div style="font-size:22px;font-weight:700">${inr(v.amount)}</div>
<div class="small"><b>${esc(amountInWords(v.amount))}</b></div>
</div>
${against || tds ? `<div class="sec box"><table class="totals"><tr><th>Against bill</th><th class="num">Amount</th></tr>${against}${tds}</table></div>` : ""}
${v.narration ? `<div class="sec box small">${esc(v.narration)}</div>` : ""}
<div class="box">${signBlock(firm.name, input.branding?.signature)}</div>
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
<div class="sec box">${firmBlock(firm, false, input.branding?.logo)}</div>
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
  // "compact-58" prints the compact layout on a 58 mm roll.
  const layout: PrintLayout = input.layout ?? input.settings.template;
  const template: InvoiceTemplate =
    layout === "compact-58" ? "compact" : layout;
  // The UPI QR (doc 37, T18) follows the current setting, not the snapshot.
  const upiQr = input.settings.upiQr;
  input = { ...input, layout, settings: { ...input.settings, template } };
  if (v.snapshot) {
    const { firm, party, items, settings, bankName } = v.snapshot;
    // Layout may change at print time; the issued business details may not.
    input = {
      ...input,
      firm,
      party,
      items,
      bankName,
      settings: {
        ...settings,
        // Older snapshots predate numbering rules; printing doesn't use them.
        numbering: settings.numbering ?? {},
        template,
        upiQr,
      },
    };
  }
  const title = printTitle(v);
  const body =
    v.type === "sale" ||
    v.type === "purchase" ||
    v.type === "credit-note" ||
    v.type === "debit-note" ||
    v.type === "estimate" ||
    v.type === "proforma" ||
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
  const roll = ROLL_WIDTH[layout];
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${PAGE_WIDTH[layout]}"/>${roll ? `<meta name="hisaab-roll" content="${roll}"/>` : ""}<title>${esc(title)} ${esc(v.number)}</title><style>${BASE_CSS}${TEMPLATE_CSS[template]}${layout === "compact-58" ? NARROW_CSS : ""}</style></head><body>${cancelled}${body}</body></html>`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return {
    title,
    html,
    fileName: `${safe(v.number)}${input.party ? ` ${safe(input.party.name)}` : ""}.pdf`,
  };
}
