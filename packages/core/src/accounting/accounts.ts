/**
 * Account keys and the chart of account groups.
 *
 * Every Dr/Cr posting names an account by a short key, so balances can be added up:
 *   party:<partyId>        a customer or supplier
 *   ledger:<ledgerId>      a cash or bank account
 *   sales, purchase        sales and purchase accounts
 *   sales-return, purchase-return   returns (credit / debit notes)
 *   output:cgst|sgst|igst  GST collected on sales
 *   input:cgst|sgst|igst   GST paid on purchases (input tax credit)
 *   tds:<section>          TDS payable, e.g. tds:194C
 *   expense:<head>         an expense, e.g. expense:Rent
 *   income:<name>          other income, e.g. income:Freight (charged to customers)
 *   asset:<name>           a fixed asset, e.g. asset:Furniture & Fixtures
 *   provision:<name>       a provision, e.g. provision:Salary Payable
 *   round-off, capital, drawings, stock
 */
import type { Ledger, Party } from "../types";

export type GroupName =
  | "Capital Account"
  | "Secured Loans"
  | "Unsecured Loans"
  | "Loans & Advances (Asset)"
  | "Other Current Assets"
  | "Other Current Liabilities"
  | "Fixed Assets"
  | "Sundry Debtors"
  | "Bank Accounts"
  | "Cash-in-hand"
  | "Stock-in-hand"
  | "Sundry Creditors"
  | "Duties & Taxes"
  | "Provisions"
  | "Sales Accounts"
  | "Purchase Accounts"
  | "Direct Expenses"
  | "Indirect Expenses"
  | "Indirect Incomes";

export type Nature = "asset" | "liability" | "income" | "expense";

export interface GroupInfo {
  name: GroupName;
  /** Top-level heading the group sits under in the chart of accounts. */
  parent:
    | "Capital"
    | "Loans"
    | "Fixed Assets"
    | "Current Assets"
    | "Current Liabilities"
    | "Income"
    | "Expenses";
  nature: Nature;
}

/** Groups in the order they appear in the chart of accounts. */
export const GROUPS: GroupInfo[] = [
  { name: "Capital Account", parent: "Capital", nature: "liability" },
  { name: "Secured Loans", parent: "Loans", nature: "liability" },
  { name: "Unsecured Loans", parent: "Loans", nature: "liability" },
  {
    name: "Loans & Advances (Asset)",
    parent: "Current Assets",
    nature: "asset",
  },
  { name: "Other Current Assets", parent: "Current Assets", nature: "asset" },
  {
    name: "Other Current Liabilities",
    parent: "Current Liabilities",
    nature: "liability",
  },
  { name: "Fixed Assets", parent: "Fixed Assets", nature: "asset" },
  { name: "Sundry Debtors", parent: "Current Assets", nature: "asset" },
  { name: "Bank Accounts", parent: "Current Assets", nature: "asset" },
  { name: "Cash-in-hand", parent: "Current Assets", nature: "asset" },
  { name: "Stock-in-hand", parent: "Current Assets", nature: "asset" },
  {
    name: "Sundry Creditors",
    parent: "Current Liabilities",
    nature: "liability",
  },
  {
    name: "Duties & Taxes",
    parent: "Current Liabilities",
    nature: "liability",
  },
  { name: "Provisions", parent: "Current Liabilities", nature: "liability" },
  { name: "Sales Accounts", parent: "Income", nature: "income" },
  { name: "Indirect Incomes", parent: "Income", nature: "income" },
  { name: "Purchase Accounts", parent: "Expenses", nature: "expense" },
  { name: "Direct Expenses", parent: "Expenses", nature: "expense" },
  { name: "Indirect Expenses", parent: "Expenses", nature: "expense" },
];

export function groupInfo(name: GroupName): GroupInfo {
  return GROUPS.find((g) => g.name === name)!;
}

/** Builders for account keys, so keys are always spelled the same way. */
export const acc = {
  account: (id: string) => `account:${id}`,
  party: (id: string) => `party:${id}`,
  ledger: (id: string) => `ledger:${id}`,
  sales: "sales",
  purchase: "purchase",
  salesReturn: "sales-return",
  purchaseReturn: "purchase-return",
  output: (head: "cgst" | "sgst" | "igst") => `output:${head}`,
  input: (head: "cgst" | "sgst" | "igst") => `input:${head}`,
  tds: (section: string) => `tds:${section}`,
  expense: (head: string) => `expense:${head}`,
  income: (name: string) => `income:${name}`,
  asset: (name: string) => `asset:${name}`,
  provision: (name: string) => `provision:${name}`,
  roundOff: "round-off",
  capital: "capital",
  drawings: "drawings",
  stock: "stock",
};

/** Expense heads that belong to the cost of goods (shown above gross profit). */
const DIRECT_EXPENSES = [
  "Freight Inward",
  "Carriage Inward",
  "Loading & Unloading",
];

export interface AccountInfo {
  key: string;
  name: string;
  group: GroupName;
}

// Parties, stock and cash/bank keep their own masters and validation.
export const CUSTOM_ACCOUNT_GROUPS = [
  "Capital Account",
  "Secured Loans",
  "Unsecured Loans",
  "Fixed Assets",
  "Loans & Advances (Asset)",
  "Other Current Assets",
  "Other Current Liabilities",
  "Provisions",
  "Direct Expenses",
  "Indirect Expenses",
  "Indirect Incomes",
] as const;

export interface AccountInput {
  name: string;
  group: (typeof CUSTOM_ACCOUNT_GROUPS)[number];
  openingBalance: number;
  openingGstBalance?: number;
  contactName: string;
  phone: string;
  note: string;
}

export interface CustomAccount extends AccountInput {
  id: string;
  version: number;
}

/** Name and group for any account key. */
export function describeAccount(
  key: string,
  ctx: { parties: Party[]; ledgers: Ledger[]; accounts?: CustomAccount[] },
): AccountInfo {
  const [kind, ...rest] = key.split(":");
  const arg = rest.join(":");
  const tax = (prefix: string) => `${prefix} ${arg.toUpperCase()}`;
  switch (kind) {
    case "account": {
      const account = ctx.accounts?.find((row) => row.id === arg);
      if (!account) throw new Error("Account not found");
      return { key, name: account.name, group: account.group };
    }
    case "party": {
      const p = ctx.parties.find((x) => x.id === arg);
      return {
        key,
        name: p?.name ?? "Unknown party",
        group: p?.type === "supplier" ? "Sundry Creditors" : "Sundry Debtors",
      };
    }
    case "ledger": {
      const l = ctx.ledgers.find((x) => x.id === arg);
      return {
        key,
        name: l?.name ?? "Unknown account",
        group: l?.kind === "cash" ? "Cash-in-hand" : "Bank Accounts",
      };
    }
    case "sales-return":
      return { key, name: "Sales Returns", group: "Sales Accounts" };
    case "purchase-return":
      return { key, name: "Purchase Returns", group: "Purchase Accounts" };
    case "sales":
      return { key, name: "Sales", group: "Sales Accounts" };
    case "purchase":
      return { key, name: "Purchase", group: "Purchase Accounts" };
    case "output":
      return { key, name: tax("Output"), group: "Duties & Taxes" };
    case "input":
      return { key, name: tax("Input"), group: "Duties & Taxes" };
    case "tds":
      return { key, name: `TDS Payable ${arg}`, group: "Duties & Taxes" };
    case "expense":
      return {
        key,
        name: arg,
        group: DIRECT_EXPENSES.includes(arg)
          ? "Direct Expenses"
          : "Indirect Expenses",
      };
    case "income":
      return { key, name: arg, group: "Indirect Incomes" };
    case "asset":
      return { key, name: arg, group: "Fixed Assets" };
    case "provision":
      return { key, name: arg, group: "Provisions" };
    case "round-off":
      return { key, name: "Round Off", group: "Indirect Expenses" };
    case "capital":
      return { key, name: "Capital", group: "Capital Account" };
    case "drawings":
      return { key, name: "Drawings", group: "Capital Account" };
    case "stock":
      return { key, name: "Opening Stock", group: "Stock-in-hand" };
    default:
      return { key, name: key, group: "Indirect Expenses" };
  }
}
