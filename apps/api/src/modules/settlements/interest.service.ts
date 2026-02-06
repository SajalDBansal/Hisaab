import { and, eq } from "drizzle-orm";
import { loanSchedule } from "@repo/core/src/accounting/loanSchedule";
import {
  loanInterestLines,
  sumPaise,
} from "@repo/core/src/accounting/settlements";
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
    const reversed = new Set(
      entries.filter((e) => e.kind === "reversal").map((e) => e.sourceEntryId),
    );
    const period = entries.filter(
      (e) =>
        e.loanId === loan.id &&
        e.installmentNumber === input.installmentNumber &&
        !reversed.has(e.id),
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
      if (period.some((e) => e.kind === "loan-interest-accrual"))
        invalid(
          "This installment already has an unreversed accrual.",
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
        "Select an unreversed accrual for this installment.",
      );
      if (
        accrual.interestAccountId !== account.id ||
        accrual.bookScope !== input.bookScope ||
        input.date < accrual.date
      )
        invalid(
          "Payment must use the accrual's interest account, book and a later/equal date.",
        );
      const paid = sumPaise(
        period
          .filter(
            (e) =>
              e.kind === "loan-interest-payment" &&
              e.sourceEntryId === accrual.id,
          )
          .map((e) => e.amount),
      );
      if (input.amount > accrual.amount - paid)
        invalid(
          "Payment exceeds the unpaid accrual.",
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
          confirmedNoDuplicate: true,
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
