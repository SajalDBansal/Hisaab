import { statementAsPage, type PageQuery } from "../paging";
import {
  acc,
  describeAccount,
  type AccountInfo,
  type AccountInput,
  type CustomAccount,
} from "../accounting/accounts";
import { newId } from "../mock/db";
import {
  accountBalances,
  accountStatement,
  chartOfAccounts,
  finalAccounts,
  trialBalance,
  type AccountStatement,
  type Books,
  type ChartGroup,
  type FinalAccounts,
  type TrialBalance,
} from "../accounting/generalLedger";
import { clone, delay, getDb } from "./client";
import { scopeBooks } from "../accounting/bookScope";
import { financialYear, today } from "../dates";
import type { TaxScope } from "../types";

const books = (): Books => {
  return getDb();
};

/** Accounts people often use in journals even before they have a balance. */
const COMMON = [
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

export const accountService = {
  async list(): Promise<CustomAccount[]> {
    await delay();
    return clone(getDb().accounts ?? []);
  },

  async create(input: AccountInput): Promise<CustomAccount> {
    await delay();
    const db = getDb();
    db.accounts ??= [];
    if (
      db.accounts.some(
        (a) => a.name.toLowerCase() === input.name.trim().toLowerCase(),
      )
    )
      throw new Error("An account with this name already exists.");
    const account = {
      ...input,
      name: input.name.trim(),
      id: newId("account"),
      version: 1,
    };
    db.accounts.push(account);
    return clone(account);
  },

  /** Groups with accounts and balances. Real API: http.get<ChartGroup[]>("/accounts/chart") */
  async chart(tax: TaxScope = "all"): Promise<ChartGroup[]> {
    await delay();
    return clone(chartOfAccounts(scopeBooks(getDb(), tax)));
  },

  /** Real API: http.get<TrialBalance>("/reports/trial-balance") */
  async trialBalance(tax: TaxScope = "all"): Promise<TrialBalance> {
    await delay();
    return clone(trialBalance(scopeBooks(getDb(), tax)));
  },

  /** Profit & loss and balance sheet. Real API: http.get<FinalAccounts>("/reports/final-accounts") */
  async finalAccounts(
    tax: TaxScope = "all",
    from = financialYear(today()).start,
    to = today(),
  ): Promise<FinalAccounts> {
    await delay();
    return clone(finalAccounts(scopeBooks(getDb(), tax), to, from));
  },

  /** Any account's statement. Real API: http.get<AccountStatement>(`/accounts/${encodeURIComponent(key)}/statement`) */
  async statement(
    key: string,
    tax: TaxScope = "all",
  ): Promise<AccountStatement> {
    await delay();
    return clone(accountStatement(scopeBooks(getDb(), tax), key));
  },

  /** A page of an account statement. Real API: `/accounts/${key}/statement?limit&cursor` */
  async statementPage(key: string, tax: TaxScope, query: PageQuery) {
    return statementAsPage(await this.statement(key, tax), query);
  },

  /** Accounts to pick from in a journal. Real API: http.get<AccountInfo[]>("/accounts") */
  async pickable(): Promise<AccountInfo[]> {
    await delay();
    const b = books();
    const keys = new Set([...accountBalances(b).map((a) => a.key), ...COMMON]);
    return clone(
      [...keys]
        .filter((k) => k !== acc.stock)
        .map((k) => describeAccount(k, b))
        .sort(
          (x, y) =>
            x.group.localeCompare(y.group) || x.name.localeCompare(y.name),
        ),
    );
  },
};
