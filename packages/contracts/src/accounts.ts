import { z } from "zod";
import { Id, IsoDate, Paise } from "./common";
import { CUSTOM_ACCOUNT_GROUPS } from "@repo/core";
import { ReportVoucher, StatementPaging } from "./reports";

export const AccountParams = z.object({ key: z.string().min(1) });

export const AccountGroupName = z.enum([
  "Capital Account",
  "Secured Loans",
  "Unsecured Loans",
  "Loans & Advances (Asset)",
  "Other Current Assets",
  "Other Current Liabilities",
  "Fixed Assets",
  "Sundry Debtors",
  "Bank Accounts",
  "Cash-in-hand",
  "Stock-in-hand",
  "Sundry Creditors",
  "Duties & Taxes",
  "Provisions",
  "Sales Accounts",
  "Purchase Accounts",
  "Direct Expenses",
  "Indirect Expenses",
  "Indirect Incomes",
]);

export const AccountInfo = z.object({
  key: z.string(),
  name: z.string(),
  group: AccountGroupName,
});

export const AccountBalance = AccountInfo.extend({ balance: Paise });

export const GroupInfo = z.object({
  name: AccountGroupName,
  parent: z.enum([
    "Capital",
    "Loans",
    "Fixed Assets",
    "Current Assets",
    "Current Liabilities",
    "Income",
    "Expenses",
  ]),
  nature: z.enum(["asset", "liability", "income", "expense"]),
});

export const ChartGroup = z.object({
  group: GroupInfo,
  balance: Paise,
  accounts: z.array(AccountBalance),
});

export const TrialBalance = z.object({
  rows: z.array(
    AccountInfo.extend({
      debit: Paise,
      credit: Paise,
    }),
  ),
  totalDebit: Paise,
  totalCredit: Paise,
});

export const StatementLine = z.object({
  key: z.string().optional(),
  name: z.string(),
  amount: Paise,
});

const BalanceSheetSide = z.object({
  sections: z.array(
    z.object({
      title: z.string(),
      lines: z.array(StatementLine),
      total: Paise,
    }),
  ),
  total: Paise,
});

export const FinalAccounts = z.object({
  profitAndLoss: z.object({
    sales: Paise,
    openingStock: Paise,
    purchases: Paise,
    directExpenses: z.array(StatementLine),
    closingStock: Paise,
    grossProfit: Paise,
    indirectIncomes: z.array(StatementLine),
    indirectExpenses: z.array(StatementLine),
    netProfit: Paise,
  }),
  balanceSheet: z.object({
    liabilities: BalanceSheetSide,
    assets: BalanceSheetSide,
    balanced: z.boolean(),
  }),
});

const StatementMovement = z.object({
  date: IsoDate,
  debit: Paise,
  credit: Paise,
  balance: Paise,
});

export const AccountStatement = AccountInfo.extend({
  ...StatementPaging,
  opening: Paise,
  totalDebit: Paise,
  totalCredit: Paise,
  closing: Paise,
  rows: z.array(
    z.discriminatedUnion("kind", [
      StatementMovement.extend({
        kind: z.literal("voucher"),
        voucher: ReportVoucher,
      }),
      StatementMovement.extend({
        kind: z.literal("opening"),
        voucher: z.null(),
        partyId: Id,
        counterAccount: z.string(),
        counterName: z.string(),
      }),
    ]),
  ),
});

export type AccountInfo = z.infer<typeof AccountInfo>;
export type ChartGroup = z.infer<typeof ChartGroup>;
export type TrialBalance = z.infer<typeof TrialBalance>;
export type FinalAccounts = z.infer<typeof FinalAccounts>;
export type AccountStatement = z.infer<typeof AccountStatement>;

export const AccountInput = z.object({
  name: z.string().trim().min(1, "Enter the account name.").max(150),
  group: z.enum(CUSTOM_ACCOUNT_GROUPS),
  openingBalance: Paise.default(0),
  contactName: z.string().trim().max(150).default(""),
  phone: z.string().trim().max(30).default(""),
  note: z.string().trim().max(500).default(""),
});
export const CustomAccount = AccountInput.extend({
  id: Id,
  openingGstBalance: Paise.nullable()
    .transform((value) => value ?? undefined)
    .optional(),
  version: z.number().int().positive(),
});
export type AccountInput = z.infer<typeof AccountInput>;
export type CustomAccount = z.infer<typeof CustomAccount>;
