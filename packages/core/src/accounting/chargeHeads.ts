/**
 * Charge heads (doc 37, T09): packing, insurance, loading and other charges a firm
 * sets up once, each with its GST treatment and the ledger it posts to.
 * A bill freezes the head's name, treatment, SAC and account on its charge line,
 * so changing or switching off a head later never changes saved bills.
 * Free-typed charges (the original Freight field) carry no head and keep their old postings.
 */
import type { ChargeHead, ExtraCharge, GstRate } from "../types";
import { acc } from "./accounts";

export const MAX_CHARGE_HEADS = 30;
const GST_RATES: GstRate[] = [0, 5, 18, 40];

/** Ledger account a head's charge posts to on this side of the books. */
export function chargeHeadAccount(
  head: Pick<ChargeHead, "name" | "salesLedger" | "purchaseLedger">,
  side: "sale" | "purchase",
): string {
  return side === "sale"
    ? acc.income(head.salesLedger?.trim() || `${head.name} Charged`)
    : acc.expense(head.purchaseLedger?.trim() || head.name);
}

/** Reject a head list that can't be saved; returns it tidied. */
export function checkChargeHeads(heads: ChargeHead[]): ChargeHead[] {
  if (heads.length > MAX_CHARGE_HEADS)
    throw new Error(`Up to ${MAX_CHARGE_HEADS} charge heads.`);
  const ids = new Set<string>();
  const names = new Set<string>();
  return heads.map((head) => {
    const name = head.name.trim();
    if (!name || name.length > 60)
      throw new Error("Name each charge in up to 60 characters.");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(head.id))
      throw new Error("A charge head has an invalid id.");
    if (ids.has(head.id)) throw new Error("Charge head ids must be unique.");
    ids.add(head.id);
    if (names.has(name.toLowerCase()))
      throw new Error(`There are two charges named ${name}.`);
    names.add(name.toLowerCase());
    if (!GST_RATES.includes(head.gstRate))
      throw new Error(`Pick a GST rate for ${name}.`);
    if (head.taxType === "taxable" && head.gstRate === 0)
      throw new Error(
        `${name} is taxable: pick its GST rate, or mark it exempt.`,
      );
    const ledger = (value?: string) => {
      const v = value?.trim();
      if (v && v.length > 60)
        throw new Error("Ledger names are up to 60 characters.");
      return v || undefined;
    };
    const sac = head.sac?.trim() || undefined;
    if (sac && !/^\d{4,8}$/.test(sac))
      throw new Error(`The SAC for ${name} must be 4 to 8 digits.`);
    return {
      id: head.id,
      name,
      taxType: head.taxType,
      gstRate: head.taxType === "taxable" ? head.gstRate : 0,
      sac,
      salesLedger: ledger(head.salesLedger),
      purchaseLedger: ledger(head.purchaseLedger),
      active: head.active,
    };
  });
}

/**
 * Charges as saved: a charge picked from a head takes the head's name, GST
 * treatment, SAC and ledger (an edit keeps what the bill already froze).
 * Free-typed charges pass through unchanged.
 */
export function resolveCharges(
  heads: ChargeHead[] | undefined,
  charges: ExtraCharge[],
  side: "sale" | "purchase",
  previous: ExtraCharge[] = [],
): ExtraCharge[] {
  return charges.map((charge) => {
    if (!charge.headId) {
      const {
        headId: _h,
        taxType: _t,
        sac: _s,
        account: _a,
        ...plain
      } = charge;
      return plain;
    }
    // An edit keeps what the bill froze; a converted order brings its frozen charge.
    const saved =
      previous.find((p) => p.headId === charge.headId) ??
      (charge.account ? charge : undefined);
    if (saved)
      return {
        name: saved.name,
        amount: charge.amount,
        gstRate: saved.gstRate,
        headId: saved.headId,
        taxType: saved.taxType,
        sac: saved.sac,
        account: saved.account,
      };
    const head = heads?.find((h) => h.id === charge.headId && h.active);
    if (!head)
      throw new Error(
        `The charge "${charge.name}" is no longer set up. Pick it again.`,
      );
    return {
      name: head.name,
      amount: charge.amount,
      gstRate: head.taxType === "taxable" ? head.gstRate : 0,
      headId: head.id,
      taxType: head.taxType,
      sac: head.sac,
      account: chargeHeadAccount(head, side),
    };
  });
}
