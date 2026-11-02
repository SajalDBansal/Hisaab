/**
 * Ledger postings: the Dr/Cr lines each voucher creates.
 * Shown on voucher screens as "Ledger posting", used to check Dr = Cr,
 * and added up by account key to build the trial balance and final accounts.
 */
import type { Paise, Voucher } from "../types";
import { acc } from "./accounts";
import { claimsInputTax, voucherMode } from "./gstMode";
import { calcInvoice } from "./invoice";

export interface Posting {
  /** Account key, e.g. "sales" or "party:c1" (see accounts.ts). */
  account: string;
  /** Display name, e.g. "Sales" or "Gupta Kirana Store". */
  ledger: string;
  debit: Paise;
  credit: Paise;
}

export interface PostingNames {
  /** Name of the party ledger, e.g. "Gupta Kirana Store". */
  party?: string;
  /** Name of the cash/bank ledger, e.g. "HDFC Bank". */
  ledger?: string;
  /** Contra: name of the ledger the money went into. */
  toLedger?: string;
}

const dr = (account: string, ledger: string, amount: Paise): Posting => ({
  account,
  ledger,
  debit: amount,
  credit: 0,
});
const cr = (account: string, ledger: string, amount: Paise): Posting => ({
  account,
  ledger,
  debit: 0,
  credit: amount,
});

export function voucherPostings(
  v: Voucher,
  names: PostingNames = {},
): Posting[] {
  // A return is the bill it reverses, posted the other way round:
  // credit note = sale reversed (Sales Returns Dr, output GST Dr, customer Cr),
  // debit note = purchase reversed (supplier Dr, Purchase Returns Cr, input GST Cr).
  if (v.type === "credit-note" || v.type === "debit-note") {
    const isCredit = v.type === "credit-note";
    const asBill = voucherPostings(
      { ...v, type: isCredit ? "sale" : "purchase", charges: [] },
      names,
    );
    return asBill.map((p) => {
      const account =
        p.account === acc.sales
          ? acc.salesReturn
          : p.account === acc.purchase
            ? acc.purchaseReturn
            : p.account;
      const ledger =
        account === acc.salesReturn
          ? "Sales Returns"
          : account === acc.purchaseReturn
            ? "Purchase Returns"
            : p.ledger;
      return { account, ledger, debit: p.credit, credit: p.debit };
    });
  }
  const partyKey = acc.party(v.partyId ?? "");
  const partyName = names.party ?? "Party";
  const ledgerKey = acc.ledger(v.ledgerId ?? "cash");
  const ledgerName = names.ledger ?? "Cash";

  if (v.type === "sale" || v.type === "purchase") {
    const isSale = v.type === "sale";
    const t = calcInvoice({
      lines: v.lines ?? [],
      charges: v.charges,
      interState: !!v.interState,
    });
    // Sales: income and tax are credits. Purchases: cost and input tax are debits.
    const side = isSale ? cr : dr;
    const tax = isSale ? acc.output : acc.input;
    const taxName = isSale ? "Output" : "Input";
    const rows: Posting[] = [];

    rows.push(
      isSale
        ? dr(partyKey, partyName, v.amount)
        : cr(partyKey, partyName, v.amount),
    );
    // Composition firms (and firms without GST) can't claim GST paid on purchases:
    // it is part of what the goods cost, so it goes into Purchase, not Input GST.
    const taxIntoCost = !isSale && !claimsInputTax(voucherMode(v));
    const itemsTax = t.lines.reduce((s, l) => s + l.tax, 0);
    rows.push(
      side(
        isSale ? acc.sales : acc.purchase,
        isSale ? "Sales" : "Purchase",
        t.itemsTaxable + (taxIntoCost ? itemsTax : 0),
      ),
    );
    (v.charges ?? []).forEach((c, i) => {
      // Freight charged to a customer is income; freight paid on a purchase is a direct expense.
      if (isSale)
        rows.push(
          cr(acc.income(`${c.name} Charged`), `${c.name} Charged`, c.amount),
        );
      else {
        const head = c.name === "Freight" ? "Freight Inward" : c.name;
        const extra = taxIntoCost ? (t.charges[i]?.tax ?? 0) : 0;
        rows.push(dr(acc.expense(head), head, c.amount + extra));
      }
    });
    if (!taxIntoCost) {
      if (t.cgst) rows.push(side(tax("cgst"), `${taxName} CGST`, t.cgst));
      if (t.sgst) rows.push(side(tax("sgst"), `${taxName} SGST`, t.sgst));
      if (t.igst) rows.push(side(tax("igst"), `${taxName} IGST`, t.igst));
    }
    if (t.roundOff) {
      // Round-off goes on whichever side makes the voucher balance.
      const onCreditSide = isSale ? t.roundOff > 0 : t.roundOff < 0;
      const amount = Math.abs(t.roundOff);
      rows.push(
        onCreditSide
          ? cr(acc.roundOff, "Round Off", amount)
          : dr(acc.roundOff, "Round Off", amount),
      );
    }
    return rows;
  }

  if (v.type === "receipt")
    return [
      dr(ledgerKey, ledgerName, v.amount),
      cr(partyKey, partyName, v.amount),
    ];

  if (v.type === "payment") {
    // With TDS: the supplier's account is cleared by the full bill value,
    // the bank pays the net amount and the TDS is owed to the government.
    const tds = v.tds?.amount ?? 0;
    const rows = [
      dr(partyKey, partyName, v.amount + tds),
      cr(ledgerKey, ledgerName, v.amount),
    ];
    if (tds)
      rows.push(
        cr(acc.tds(v.tds!.section), `TDS Payable ${v.tds!.section}`, tds),
      );
    return rows;
  }

  if (v.type === "contra") {
    // Money goes into one cash/bank account and out of the other
    return [
      dr(acc.ledger(v.toLedgerId ?? ""), names.toLedger ?? "Bank", v.amount),
      cr(ledgerKey, ledgerName, v.amount),
    ];
  }

  if (v.type === "expense") {
    const head = v.expenseHead ?? "Expenses";
    if (!v.charges?.length)
      return [
        dr(acc.expense(head), head, v.amount),
        cr(ledgerKey, ledgerName, v.amount),
      ];
    // GST on the supplier's bill is input credit for a regular firm, otherwise cost.
    const t = calcInvoice({
      lines: [],
      charges: v.charges,
      interState: !!v.interState,
    });
    const claim = claimsInputTax(voucherMode(v));
    const rows = [
      dr(acc.expense(head), head, t.taxable + (claim ? 0 : t.tax)),
    ];
    if (claim) {
      if (t.cgst) rows.push(dr(acc.input("cgst"), "Input CGST", t.cgst));
      if (t.sgst) rows.push(dr(acc.input("sgst"), "Input SGST", t.sgst));
      if (t.igst) rows.push(dr(acc.input("igst"), "Input IGST", t.igst));
    }
    rows.push(cr(ledgerKey, ledgerName, v.amount));
    return rows;
  }

  if (v.type === "journal") {
    return (v.journalLines ?? []).map((l) => ({
      account: l.account,
      ledger: l.name,
      debit: l.debit,
      credit: l.credit,
    }));
  }

  return [];
}

export function postingTotals(rows: Posting[]) {
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return {
    debit,
    credit,
    difference: debit - credit,
    balanced: debit === credit,
  };
}
