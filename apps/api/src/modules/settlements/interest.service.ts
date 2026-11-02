import { and, eq } from "drizzle-orm";
import { loanSchedule } from "@repo/core/src/accounting/loanSchedule";
import {
  loanInterestPaymentCapacity,
  loanInterestReversalDate,
} from "@repo/core/src/accounting/loanInterest";
import { loanInterestLines } from "@repo/core/src/accounting/settlements";
import type { LoanInterestInput } from "@repo/contracts/src/settlements";
import { schema, type Db } from "@repo/backend/db/client";
import { loans, loanRepaymentReferences } from "@repo/backend/db/schema/loans";
import { settlementEntries } from "@repo/backend/db/schema/settlements";
import {
  invalid,
  postSettlement,
  required,
  settlementWrite,
  type SettlementActor,
} from "@repo/backend/modules/settlements/settlements.shared";

export async function postLoanInterest(
  db: Db,
  actor: SettlementActor,
  input: LoanInterestInput,
) {
  return settlementWrite(db, actor, async (tx) => {
    if (input.confirmedNoDuplicate !== true)
      invalid("Review the interest and confirm that it is not duplicated.");
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.firmId, actor.firmId), eq(loans.id, input.loanId)));
    if (!loan || loan.status !== "active") invalid("Select an active loan.");
    if (loan.version !== input.loanVersion)
      invalid(
        "The loan changed. Reload before posting.",
        "EDITED_ELSEWHERE",
        409,
      );
    const installment = required(
      loanSchedule(loan.terms).installments.find(
        (i) => i.number === input.installmentNumber,
      ),
      "Installment not found.",
    );
    if (input.date < installment.dueDate)
      invalid("Post interest only when this contractual period is due.");
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.firmId, actor.firmId),
          eq(schema.accounts.id, input.interestAccountId),
        ),
      );
    if (
      !account ||
      account.id === loan.accountId ||
      account.group !==
        (loan.direction === "borrowed"
          ? "Other Current Liabilities"
          : "Other Current Assets")
    )
      invalid(
        "Select a separate accrued-interest account in the matching asset/liability group.",
      );
    const entries = await tx
      .select()
      .from(settlementEntries)
      .where(eq(settlementEntries.firmId, actor.firmId));
    if (
      entries.some(
        (e) => e.interestAccountId === account.id && e.loanId !== loan.id,
      )
    )
      invalid("Use a dedicated interest account for this loan.");
    const period = entries.filter(
      (e) =>
        e.loanId === loan.id && e.installmentNumber === input.installmentNumber,
    );
    const references = await tx
      .select()
      .from(loanRepaymentReferences)
      .where(
        and(
          eq(loanRepaymentReferences.firmId, actor.firmId),
          eq(loanRepaymentReferences.loanId, loan.id),
          eq(
            loanRepaymentReferences.installmentNumber,
            input.installmentNumber,
          ),
        ),
      );
    if (input.kind === "loan-interest-accrual") {
      if (
        period.some((e) => {
          if (e.kind !== "loan-interest-accrual") return false;
          const reversedOn = loanInterestReversalDate(period, e);
          // The new accrual remains active at every later recorded date.
          return !reversedOn || reversedOn > input.date;
        })
      )
        invalid(
          "This installment already has an accrual active on this or a later recorded date.",
          "DUPLICATE_INTEREST",
          409,
        );
      const journals = await tx
        .select()
        .from(schema.vouchers)
        .where(eq(schema.vouchers.firmId, actor.firmId));
      if (
        references.some(
          (r) =>
            r.interest > 0 &&
            journals.some((v) => v.id === r.voucherId && v.status === "posted"),
        )
      )
        invalid(
          "This installment already references directly posted interest, including removed links. Reconcile its journal before accruing.",
          "DUPLICATE_INTEREST",
          409,
        );
    } else {
      const accrual = required(
        period.find(
          (e) =>
            e.id === input.sourceEntryId && e.kind === "loan-interest-accrual",
        ),
        "Select an accrual for this installment.",
      );
      const reversedOn = loanInterestReversalDate(period, accrual);
      if (reversedOn && reversedOn <= input.date)
        invalid("Select an accrual that is not reversed on the payment date.");
      if (
        accrual.interestAccountId !== account.id ||
        accrual.bookScope !== input.bookScope ||
        input.date < accrual.date
      )
        invalid(
          "Payment must use the accrual's interest account, book and a later/equal date.",
        );
      if (
        input.amount > loanInterestPaymentCapacity(period, accrual, input.date)
      )
        invalid(
          "Payment exceeds the unpaid accrual on this or a later recorded date.",
          "INTEREST_OVERPAYMENT",
          409,
        );
    }
    let bank;
    if (input.kind === "loan-interest-payment") {
      const [row] = await tx
        .select()
        .from(schema.ledgers)
        .where(
          and(
            eq(schema.ledgers.firmId, actor.firmId),
            eq(schema.ledgers.id, input.ledgerId ?? ""),
          ),
        );
      if (!row || row.deletedAt)
        invalid("Select an active cash or bank account.");
      bank = row;
    }
    const result = await postSettlement(
      tx,
      actor,
      {
        kind: input.kind,
        loanId: loan.id,
        interestAccountId: account.id,
        sourceEntryId:
          input.kind === "loan-interest-payment" ? input.sourceEntryId : null,
        installmentNumber: input.installmentNumber,
        date: input.date,
        bookScope: input.bookScope,
        amount: input.amount,
        reason: input.reason,
        details: {
          plannedInterest: installment.interest,
          confirmedAmount: input.amount,
          confirmedNoDuplicate: input.confirmedNoDuplicate,
          loanVersion: loan.version,
          dueDate: installment.dueDate,
        },
      },
      loanInterestLines(
        loan.direction,
        input.kind === "loan-interest-accrual" ? "accrual" : "payment",
        input.amount,
        account,
        bank,
      ),
    );
    await tx
      .update(loans)
      .set({ version: loan.version + 1, updatedAt: new Date() })
      .where(eq(loans.id, loan.id));
    return result;
  });
}
