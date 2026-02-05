import { acc, financingLines, type Ledger, type Voucher } from "@repo/core";
import type {
  LoanRecord,
  LoanReferenceAllocation,
} from "@repo/contracts/src/loans";

type RepaymentAmounts = { principal: number; interest: number };
const validAmounts = (amounts: RepaymentAmounts) =>
  Number.isSafeInteger(amounts.principal) &&
  amounts.principal > 0 &&
  Number.isSafeInteger(amounts.interest) &&
  amounts.interest >= 0;

/** Accept legacy whole-principal references and explicitly reviewed positive-principal splits. */
export function repaymentReferenceMatches(
  source: RepaymentAmounts | null,
  reference: RepaymentAmounts,
): boolean {
  if (!source || !validAmounts(source) || !validAmounts(reference))
    return false;
  const sourceTotal = BigInt(source.principal) + BigInt(source.interest);
  return (
    reference.principal <= source.principal &&
    reference.interest >= source.interest &&
    sourceTotal <= BigInt(Number.MAX_SAFE_INTEGER) &&
    BigInt(reference.principal) + BigInt(reference.interest) === sourceTotal
  );
}

export function reviewRepaymentAllocation(
  source: RepaymentAmounts,
  allocation?: LoanReferenceAllocation,
): RepaymentAmounts {
  if (!repaymentReferenceMatches(source, source))
    throw new Error("Invalid repayment journal amounts.");
  if (!allocation) return { ...source };
  if (
    allocation.confirmed !== true ||
    !Number.isSafeInteger(allocation.principal) ||
    allocation.principal <= 0 ||
    !Number.isSafeInteger(allocation.settledInterest) ||
    allocation.settledInterest < 0 ||
    BigInt(allocation.principal) + BigInt(allocation.settledInterest) !==
      BigInt(source.principal)
  )
    throw new Error(
      "Reviewed principal plus settled interest must equal the loan-account reduction, with positive principal.",
    );
  const reference = {
    principal: allocation.principal,
    interest: source.interest + allocation.settledInterest,
  };
  if (!repaymentReferenceMatches(source, reference))
    throw new Error(
      "The reviewed repayment amounts exceed the supported range.",
    );
  return reference;
}

/** Validate journal shape; a separate user confirmation identifies principal versus accrued interest. */
export function repaymentAmounts(
  loan: Pick<LoanRecord, "accountId" | "direction">,
  voucher: Voucher,
  ledgers: Ledger[],
) {
  if (voucher.type !== "journal" || voucher.status !== "posted") return null;
  const lines = voucher.journalLines ?? [];
  const key = acc.account(loan.accountId);
  const incoming = loan.direction === "lent";
  const principalLine = lines.find((line) => line.account === key);
  const interestKey = incoming
    ? acc.income("Interest Received")
    : acc.expense("Interest Paid");
  const interestLine = lines.find((line) => line.account === interestKey);
  const bankLine = lines.find((line) => line.account.startsWith("ledger:"));
  const bank = ledgers.find((row) => acc.ledger(row.id) === bankLine?.account);
  if (!principalLine || !bank || !bankLine) return null;
  const principal = incoming ? principalLine.credit : principalLine.debit;
  const interest = interestLine
    ? incoming
      ? interestLine.credit
      : interestLine.debit
    : 0;
  try {
    const expected = financingLines({
      kind: incoming ? "loan-recover" : "loan-repay",
      account: {
        key,
        name: "",
        group: incoming ? "Loans & Advances (Asset)" : "Unsecured Loans",
      },
      bank: {
        key: bankLine.account,
        name: bank.name,
        group: bank.kind === "cash" ? "Cash-in-hand" : "Bank Accounts",
      },
      principal,
      interest,
    });
    if (
      lines.length !== expected.length ||
      expected.some(
        (row) =>
          lines.filter(
            (line) =>
              line.account === row.account &&
              line.debit === row.debit &&
              line.credit === row.credit,
          ).length !== 1,
      )
    )
      return null;
    return { principal, interest };
  } catch {
    return null;
  }
}
