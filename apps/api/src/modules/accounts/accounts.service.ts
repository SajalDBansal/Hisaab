import {
  acc,
  accountBalances,
  accountStatement,
  chartOfAccounts,
  describeAccount,
  scopeBooks,
  type TaxScope,
} from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import { loadReportSnapshot } from "@repo/backend/modules/reports/books";
import { notFound } from "@repo/backend/modules/masters/shared";

const COMMON_ACCOUNTS = [
  acc.expense("Salary"),
  acc.expense("Rent"),
  acc.expense("Depreciation"),
  acc.expense("Bank Charges"),
  acc.expense("Interest Paid"),
  acc.expense("Office Expenses"),
  acc.income("Interest Received"),
  acc.income("Discount Received"),
  acc.provision("Salary Payable"),
  acc.provision("Rent Payable"),
  acc.capital,
  acc.drawings,
];

export const accountsService = {
  /** Chart groups with their account balances. */
  async chart(db: Db, firmId: string, tax: TaxScope = "all") {
    return chartOfAccounts(
      scopeBooks(await loadReportSnapshot(db, firmId), tax),
    );
  },

  /** Accounts shown in journal account pickers. */
  async pickable(db: Db, firmId: string) {
    const books = await loadReportSnapshot(db, firmId);
    const keys = new Set([
      ...accountBalances(books).map((account) => account.key),
      ...COMMON_ACCOUNTS,
    ]);

    return [...keys]
      .filter((key) => key !== acc.stock)
      .map((key) => describeAccount(key, books))
      .sort(
        (left, right) =>
          left.group.localeCompare(right.group) ||
          left.name.localeCompare(right.name),
      );
  },

  /** One account's running statement, newest entries first. */
  async statement(db: Db, firmId: string, key: string, tax: TaxScope = "all") {
    const books = await loadReportSnapshot(db, firmId);
    if (
      !accountBalances(books).some((a) => a.key === key) &&
      !COMMON_ACCOUNTS.includes(key)
    )
      throw notFound("account");
    return accountStatement(scopeBooks(books, tax), key);
  },
};
