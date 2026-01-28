/**
 * Bank reconciliation (like Tally's): tick off each bank entry when it shows up in
 * the bank statement. Entries not yet in the statement explain why the bank's
 * balance differs from the books.
 */
import type { ISODate, Ledger, Paise, Voucher } from "../types";
import { isPosted } from "./bills";
import { ledgerEffect } from "./reports";

export interface BankEntry {
  voucher: Voucher;
  /** + money into the bank, − money out. */
  amount: Paise;
  /** Date it appeared in the bank statement, if it has. */
  clearedOn?: ISODate;
}

export interface Reconciliation {
  /** Balance as per our books on `asOf`. */
  booksBalance: Paise;
  /** Deposits entered in the books but not yet in the bank (e.g. cheque deposited today). */
  unclearedIn: Paise;
  /** Payments entered in the books but not yet out of the bank (e.g. cheque given, not presented). */
  unclearedOut: Paise;
  /** What the bank statement should show: books − uncleared deposits + uncleared payments. */
  bankBalance: Paise;
  /** Newest first. */
  entries: BankEntry[];
}

export function bankClearedOn(v: Voucher, ledgerId: string) {
  return v.bankClearings
    ? v.bankClearings[ledgerId]
    : v.ledgerId === ledgerId
      ? v.clearedOn
      : undefined;
}

export function bankReconciliation(
  ledger: Ledger,
  vouchers: Voucher[],
  asOf: ISODate,
): Reconciliation {
  const entries: BankEntry[] = vouchers
    .filter((v) => isPosted(v) && v.date <= asOf)
    .map((v) => ({
      voucher: v,
      amount: ledgerEffect(v, ledger.id),
      clearedOn:
        (bankClearedOn(v, ledger.id) ?? "9999-12-31") <= asOf
          ? bankClearedOn(v, ledger.id)
          : undefined,
    }))
    .filter((e) => e.amount !== 0)
    .sort(
      (a, b) =>
        b.voucher.date.localeCompare(a.voucher.date) ||
        b.voucher.number.localeCompare(a.voucher.number),
    );
  const booksBalance =
    ledger.openingBalance + entries.reduce((s, e) => s + e.amount, 0);
  const open = entries.filter((e) => !e.clearedOn);
  const unclearedIn = open
    .filter((e) => e.amount > 0)
    .reduce((s, e) => s + e.amount, 0);
  const unclearedOut = open
    .filter((e) => e.amount < 0)
    .reduce((s, e) => s - e.amount, 0);
  return {
    booksBalance,
    unclearedIn,
    unclearedOut,
    bankBalance: booksBalance - unclearedIn + unclearedOut,
    entries,
  };
}
