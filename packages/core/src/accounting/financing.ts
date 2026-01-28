import type { JournalLine } from "../types";
import { acc, type AccountInfo } from "./accounts";

export const FINANCING_ENTRIES = [
  { id: "loan-in", title: "Loan received" },
  { id: "loan-repay", title: "Loan repayment" },
  { id: "interest-paid", title: "Interest paid" },
  { id: "interest-due", title: "Interest accrued" },
  { id: "interest-settle", title: "Pay already accrued interest" },
  { id: "capital-in", title: "Capital introduced" },
  { id: "capital-out", title: "Capital withdrawn" },
  { id: "loan-out", title: "Loan given" },
  { id: "loan-recover", title: "Loan recovered" },
] as const;
export type FinancingKind = (typeof FINANCING_ENTRIES)[number]["id"];

export function financingGroups(kind: FinancingKind): string[] {
  if (kind.startsWith("capital")) return ["Capital Account"];
  if (kind === "loan-out" || kind === "loan-recover")
    return ["Loans & Advances (Asset)"];
  return ["Secured Loans", "Unsecured Loans"];
}

/** Build an ordinary balanced journal; principal never becomes income or an expense. */
export function financingLines(input: {
  kind: FinancingKind;
  account: AccountInfo;
  bank?: AccountInfo;
  principal: number;
  interest: number;
}): JournalLine[] {
  const { kind, account, bank, principal, interest } = input;
  for (const amount of [principal, interest])
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new Error("Enter valid amounts in whole paise.");
  if (!financingGroups(kind).includes(account.group))
    throw new Error("Pick an account in the correct group.");
  if (
    kind !== "interest-due" &&
    (!bank || !["Cash-in-hand", "Bank Accounts"].includes(bank.group))
  )
    throw new Error("Pick a cash or bank account.");
  const interestOnly = kind.startsWith("interest-");
  if (interestOnly ? interest <= 0 || principal !== 0 : principal <= 0)
    throw new Error(
      interestOnly
        ? "Enter the interest amount."
        : "Enter the principal amount.",
    );
  if (
    !interestOnly &&
    kind !== "loan-repay" &&
    kind !== "loan-recover" &&
    interest !== 0
  )
    throw new Error("Interest belongs on a repayment or interest entry.");
  if (!Number.isSafeInteger(principal + interest))
    throw new Error("Amount is too large.");

  const rows: JournalLine[] = [];
  const add = (key: string, name: string, debit: number, credit: number) => {
    if (debit || credit) rows.push({ account: key, name, debit, credit });
  };
  const incoming = ["loan-in", "capital-in", "loan-recover"].includes(kind);
  if (interestOnly) {
    // Accrued interest is already expensed; settlement reduces the loan liability only.
    if (kind === "interest-settle") add(account.key, account.name, interest, 0);
    else add(acc.expense("Interest Paid"), "Interest Paid", interest, 0);
    const target = kind === "interest-due" ? account : bank!;
    add(target.key, target.name, 0, interest);
  } else {
    add(
      account.key,
      account.name,
      incoming ? 0 : principal,
      incoming ? principal : 0,
    );
    if (interest)
      add(
        incoming
          ? acc.income("Interest Received")
          : acc.expense("Interest Paid"),
        incoming ? "Interest Received" : "Interest Paid",
        incoming ? 0 : interest,
        incoming ? interest : 0,
      );
    add(
      bank!.key,
      bank!.name,
      incoming ? principal + interest : 0,
      incoming ? 0 : principal + interest,
    );
  }
  return rows;
}
