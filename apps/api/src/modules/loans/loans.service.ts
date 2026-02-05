import { acc, accountBalances, today, type MockDb } from "@repo/core";
import {
  loanSchedule,
  loanRateUpdateAllowed,
} from "@repo/core/src/accounting/loanSchedule";
import { sumPaise } from "@repo/core/src/accounting/settlements";
import {
  LoanDetail,
  LoanRecord,
  LoanReference,
  type LoanInput,
  type LoanUpdate,
  type LoanReferenceInput,
} from "@repo/contracts/src/loans";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import {
  loans,
  loanEvents,
  loanRepaymentReferences,
} from "@repo/backend/db/schema/loans";
import { AppError } from "@repo/backend/lib/app-error";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { isUniqueViolation, notFound } from "@repo/backend/modules/masters/shared";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { rememberAnswer, replayOf, type Idem } from "@repo/backend/modules/vouchers/idempotency";
import {
  repaymentAmounts,
  repaymentReferenceMatches,
  reviewRepaymentAllocation,
} from "./loans.journals";
import { settlementEntries } from "@repo/backend/db/schema/settlements";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ReadDb = Pick<Db, "select">;
type Page = { limit: number; cursor?: string };
export type LoanActor = {
  firmId: string;
  userId: string;
  userName: string;
  idem: Idem;
};

const record = (row: typeof loans.$inferSelect | undefined) => {
  if (!row) throw new Error("Loan row missing after write.");
  return LoanRecord.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
};
const whereLoan = (firmId: string, id: string) =>
  and(eq(loans.firmId, firmId), eq(loans.id, id));
const conflict = () =>
  new AppError(
    "VERSION_CONFLICT",
    "This loan changed. Reload it and review your changes before saving.",
    409,
  );

async function readLoan(db: ReadDb, firmId: string, id: string) {
  const [row] = await db.select().from(loans).where(whereLoan(firmId, id));
  if (!row) throw notFound("loan");
  return record(row);
}

function summary(
  loan: LoanRecord,
  books: MockDb,
  balances = accountBalances(books),
) {
  const account = books.accounts?.find((row) => row.id === loan.accountId);
  if (!account) throw notFound("loan account");
  return {
    loan,
    accountName: account.name,
    postedBalance:
      balances.find((row) => row.key === acc.account(loan.accountId))
        ?.balance ?? 0,
  };
}

async function loanBooks(db: ReadDb, firmId: string) {
  const books = await loadReportBooks(db, firmId, { includeDeleted: true });
  // Report hydration deliberately omits write versions; reference review needs the DB versions.
  const rows = await db
    .select({ id: schema.vouchers.id, version: schema.vouchers.version })
    .from(schema.vouchers)
    .where(eq(schema.vouchers.firmId, firmId));
  const versions = new Map(rows.map((row) => [row.id, row.version]));
  return {
    ...books,
    vouchers: books.vouchers.map((v) => ({
      ...v,
      version: versions.get(v.id),
    })),
  };
}

async function detail(db: ReadDb, firmId: string, id: string) {
  const loan = await readLoan(db, firmId, id);
  const books = await loanBooks(db, firmId);
  const rows = await db
    .select()
    .from(loanRepaymentReferences)
    .where(
      and(
        eq(loanRepaymentReferences.firmId, firmId),
        eq(loanRepaymentReferences.loanId, id),
      ),
    )
    .orderBy(
      asc(loanRepaymentReferences.createdAt),
      asc(loanRepaymentReferences.id),
    );
  const references: LoanReference[] = rows.map((row) => {
    const voucher = books.vouchers.find((v) => v.id === row.voucherId);
    const amounts = voucher
      ? repaymentAmounts(loan, voucher, books.ledgers)
      : null;
    const matches =
      voucher?.version === row.voucherVersion &&
      voucher?.date === row.voucherDate &&
      voucher?.number === row.voucherNumber &&
      repaymentReferenceMatches(amounts, row);
    const state = row.removedAt
      ? "removed"
      : !voucher
        ? "missing"
        : voucher.status === "cancelled"
          ? "cancelled"
          : !matches
            ? "changed"
            : "valid";
    return LoanReference.parse({
      ...row,
      state,
      sourceValues:
        matches && amounts
          ? {
              accountReduction: amounts.principal,
              separatelyPostedInterest: amounts.interest,
              settledInterest: amounts.principal - row.principal,
            }
          : undefined,
      createdAt: row.createdAt.toISOString(),
      removedAt: row.removedAt?.toISOString() ?? null,
    });
  });
  return LoanDetail.parse({
    ...summary(loan, books),
    schedule: loanSchedule(loan.terms),
    references,
    referencedPrincipal: references
      .filter((r) => r.state === "valid")
      .reduce((s, r) => s + r.principal, 0),
    referencedInterest: references
      .filter((r) => r.state === "valid")
      .reduce((s, r) => s + r.interest, 0),
  });
}

async function checkAccount(db: ReadDb, firmId: string, input: LoanInput) {
  const [account] = await db
    .select()
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.firmId, firmId),
        eq(schema.accounts.id, input.accountId),
      ),
    );
  const groups =
    input.direction === "lent"
      ? ["Loans & Advances (Asset)"]
      : ["Secured Loans", "Unsecured Loans"];
  if (!account || !groups.includes(account.group))
    throw new AppError(
      "INVALID_ACCOUNT",
      "Choose an existing loan account in this firm with the correct group.",
      422,
    );
}

async function audit(
  tx: Tx,
  actor: LoanActor,
  loanId: string,
  action: typeof loanEvents.$inferInsert.action,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await tx.insert(loanEvents).values({
    id: uuidv7(),
    firmId: actor.firmId,
    loanId,
    action,
    reason,
    userId: actor.userId,
    userName: actor.userName,
    before,
    after,
  });
}

async function write(
  db: Db,
  actor: LoanActor,
  status: number,
  change: (tx: Tx) => Promise<LoanRecord>,
) {
  try {
    return await withFirmWrite(db, actor.firmId, async (tx) => {
      // Recheck membership inside the same lock, before returning any saved response.
      const [member] = await tx
        .select()
        .from(schema.member)
        .where(
          and(
            eq(schema.member.organizationId, actor.firmId),
            eq(schema.member.userId, actor.userId),
          ),
        );
      if (!member || !["owner", "accountant"].includes(member.role))
        throw new AppError(
          "FORBIDDEN",
          "Only an owner or accountant can change loans.",
          403,
        );
      const replay = await replayOf<LoanRecord>(tx, actor.userId, actor.idem);
      if (replay) return LoanRecord.parse(replay);
      const result = await change(tx);
      await rememberAnswer(tx, actor.userId, actor.idem, status, result);
      return result;
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(
        "DUPLICATE",
        "This loan name, account or repayment journal is already registered.",
        409,
      );
    throw error;
  }
}

async function advance(tx: Tx, loan: LoanRecord, firmId: string) {
  const [row] = await tx
    .update(loans)
    .set({ version: loan.version + 1 })
    .where(whereLoan(firmId, loan.id))
    .returning();
  return record(row);
}

export const loansService = {
  get(db: Db, firmId: string, id: string) {
    return db.transaction((tx) => detail(tx, firmId, id), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  },
  list(db: Db, firmId: string, page: Page) {
    return db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(loans)
          .where(
            and(
              eq(loans.firmId, firmId),
              page.cursor ? gt(loans.id, page.cursor) : undefined,
            ),
          )
          .orderBy(asc(loans.id))
          .limit(page.limit + 1);
        const books = await loadReportBooks(tx, firmId);
        const balances = accountBalances(books);
        const items = rows
          .slice(0, page.limit)
          .map((row) => summary(record(row), books, balances));
        return {
          items,
          nextCursor:
            rows.length > page.limit ? (items.at(-1)?.loan.id ?? null) : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  history(db: Db, firmId: string, id: string, page: Page) {
    return db.transaction(
      async (tx) => {
        await readLoan(tx, firmId, id);
        const rows = await tx
          .select()
          .from(loanEvents)
          .where(
            and(
              eq(loanEvents.firmId, firmId),
              eq(loanEvents.loanId, id),
              page.cursor ? lt(loanEvents.id, page.cursor) : undefined,
            ),
          )
          .orderBy(desc(loanEvents.id))
          .limit(page.limit + 1);
        const items = rows
          .slice(0, page.limit)
          .map((row) => ({ ...row, at: row.at.toISOString() }));
        return {
          items,
          nextCursor:
            rows.length > page.limit ? (items.at(-1)?.id ?? null) : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  candidates(db: Db, firmId: string, id: string, page: Page) {
    return db.transaction(
      async (tx) => {
        const loan = await readLoan(tx, firmId, id);
        const books = await loanBooks(tx, firmId);
        const references = await tx
          .select()
          .from(loanRepaymentReferences)
          .where(eq(loanRepaymentReferences.firmId, firmId));
        const used = new Set(
          references
            .filter((row) => !row.removedAt)
            .map((row) => row.voucherId),
        );
        const items = books.vouchers
          .filter(
            (v) =>
              !used.has(v.id) &&
              v.date >= loan.terms.startDate &&
              (!page.cursor || v.id > page.cursor),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .flatMap((v) => {
            const amounts = repaymentAmounts(loan, v, books.ledgers);
            return amounts && v.version
              ? [
                  {
                    id: v.id,
                    version: v.version,
                    number: v.number,
                    date: v.date,
                    accountReduction: amounts.principal,
                    separatelyPostedInterest: amounts.interest,
                  },
                ]
              : [];
          });
        return {
          items: items.slice(0, page.limit),
          nextCursor:
            items.length > page.limit
              ? (items[page.limit - 1]?.id ?? null)
              : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  create(db: Db, actor: LoanActor, input: LoanInput) {
    return write(db, actor, 201, async (tx) => {
      await checkAccount(tx, actor.firmId, input);
      await assertOpenPeriod(tx, actor.firmId, [input.terms.startDate]);
      const schedule = loanSchedule(input.terms);
      const [row] = await tx
        .insert(loans)
        .values({
          ...input,
          id: uuidv7(),
          firmId: actor.firmId,
          maturityDate: schedule.maturityDate,
        })
        .returning();
      const result = record(row);
      await audit(
        tx,
        actor,
        result.id,
        "created",
        "Loan registered",
        {},
        result,
      );
      return result;
    });
  },
  update(
    db: Db,
    actor: LoanActor,
    id: string,
    version: number,
    input: LoanUpdate,
  ) {
    return write(db, actor, 200, async (tx) => {
      const before = await readLoan(tx, actor.firmId, id);
      if (before.version !== version) throw conflict();
      if (
        before.accountId !== input.accountId ||
        before.direction !== input.direction
      )
        throw new AppError(
          "LOAN_ACCOUNT_FIXED",
          "The linked account and loan direction cannot be changed after registration.",
          409,
        );
      await assertOpenPeriod(tx, actor.firmId, [today()]);
      await checkAccount(tx, actor.firmId, input);
      const termsChanged =
        JSON.stringify(before.terms) !== JSON.stringify(input.terms) ||
        before.accountId !== input.accountId ||
        before.direction !== input.direction;
      const interestHistory = await tx
        .select()
        .from(settlementEntries)
        .where(
          and(
            eq(settlementEntries.firmId, actor.firmId),
            eq(settlementEntries.loanId, id),
          ),
        );
      if (termsChanged) {
        const references = await tx
          .select()
          .from(loanRepaymentReferences)
          .where(
            and(
              eq(loanRepaymentReferences.firmId, actor.firmId),
              eq(loanRepaymentReferences.loanId, id),
            ),
          );
        const schedule = loanSchedule(before.terms);
        const protectedInstallments = new Set([
          ...references.map((r) => r.installmentNumber),
          ...interestHistory.flatMap((e) =>
            e.installmentNumber ? [e.installmentNumber] : [],
          ),
        ]);
        const protectedThrough = schedule.installments
          .filter((r) => protectedInstallments.has(r.number))
          .reduce((date, r) => (r.dueDate > date ? r.dueDate : date), today());
        const futureRatesOnly = loanRateUpdateAllowed(
          before.terms,
          input.terms,
          protectedThrough,
        );
        if (!futureRatesOnly)
          await assertOpenPeriod(tx, actor.firmId, [
            before.terms.startDate,
            input.terms.startDate,
          ]);
        if ((references.length || interestHistory.length) && !futureRatesOnly)
          throw new AppError(
            "TERMS_REFERENCED",
            "Only future rate revisions after all protected periods may change once references or interest postings exist.",
            409,
          );
      }
      if (input.status === "closed") {
        const current = await detail(tx, actor.firmId, id);
        const reversed = new Set(
          interestHistory
            .filter((e) => e.kind === "reversal")
            .map((e) => e.sourceEntryId),
        );
        const unpaidInterest = sumPaise(
          interestHistory
            .filter((e) => !reversed.has(e.id))
            .map((e) =>
              e.kind === "loan-interest-accrual"
                ? e.amount
                : e.kind === "loan-interest-payment"
                  ? -e.amount
                  : 0,
            ),
        );
        if (
          unpaidInterest !== 0 ||
          current.postedBalance !== 0 ||
          current.references.some(
            (r) => !["valid", "removed"].includes(r.state),
          )
        )
          throw new AppError(
            "LOAN_NOT_SETTLED",
            "Settle the principal account and tracked interest accruals, and resolve all repayment references before closing.",
            409,
          );
      }
      const { reason, ...values } = input;
      const [row] = await tx
        .update(loans)
        .set({
          ...values,
          maturityDate: loanSchedule(input.terms).maturityDate,
          version: version + 1,
        })
        .where(whereLoan(actor.firmId, id))
        .returning();
      const result = record(row);
      await audit(tx, actor, id, "updated", reason, before, result);
      return result;
    });
  },
  addReference(
    db: Db,
    actor: LoanActor,
    id: string,
    version: number,
    input: LoanReferenceInput,
  ) {
    return write(db, actor, 201, async (tx) => {
      if (input.principalConfirmed !== true)
        throw new AppError(
          "PRINCIPAL_CONFIRMATION_REQUIRED",
          "Confirm the reviewed principal amount before linking this repayment.",
          422,
        );
      const loan = await readLoan(tx, actor.firmId, id);
      if (loan.version !== version) throw conflict();
      if (loan.status !== "active")
        throw new AppError(
          "LOAN_CLOSED",
          "Reopen this loan before adding a reference.",
          409,
        );
      if (input.installmentNumber > loan.terms.installments)
        throw new AppError(
          "INVALID_INSTALLMENT",
          "Choose an installment in this schedule.",
          422,
        );
      const books = await loanBooks(tx, actor.firmId);
      const voucher = books.vouchers.find((v) => v.id === input.voucherId);
      if (!voucher) throw notFound("journal");
      if (voucher.version !== input.voucherVersion)
        throw new AppError(
          "JOURNAL_CHANGED",
          "This journal changed. Reload and review it before linking.",
          409,
        );
      const amounts = repaymentAmounts(loan, voucher, books.ledgers);
      if (!amounts || voucher.date < loan.terms.startDate)
        throw new AppError(
          "INVALID_REPAYMENT",
          "Choose a posted principal repayment journal for this loan account dated on or after its start.",
          422,
        );
      await assertOpenPeriod(tx, actor.firmId, [voucher.date, today()]);
      let reviewed: ReturnType<typeof reviewRepaymentAllocation>;
      try {
        reviewed = reviewRepaymentAllocation(amounts, input.allocation);
      } catch (error) {
        throw new AppError(
          "INVALID_REPAYMENT_ALLOCATION",
          error instanceof Error
            ? error.message
            : "Invalid repayment allocation.",
          422,
        );
      }
      if (reviewed.interest > 0) {
        const history = await tx
          .select()
          .from(settlementEntries)
          .where(
            and(
              eq(settlementEntries.firmId, actor.firmId),
              eq(settlementEntries.loanId, id),
              eq(settlementEntries.installmentNumber, input.installmentNumber),
            ),
          );
        const reversed = new Set(
          history
            .filter((e) => e.kind === "reversal")
            .map((e) => e.sourceEntryId),
        );
        if (
          history.some(
            (e) => e.kind === "loan-interest-accrual" && !reversed.has(e.id),
          )
        )
          throw new AppError(
            "DUPLICATE_INTEREST",
            "This installment has a managed interest accrual. Settle it separately before linking other interest for this installment.",
            409,
          );
      }
      const current = await detail(tx, actor.firmId, id);
      if (
        !Number.isSafeInteger(
          current.referencedPrincipal + reviewed.principal,
        ) ||
        !Number.isSafeInteger(current.referencedInterest + reviewed.interest)
      )
        throw new AppError(
          "AMOUNT_TOO_LARGE",
          "Referenced totals exceed the supported amount range.",
          422,
        );
      const [reference] = await tx
        .insert(loanRepaymentReferences)
        .values({
          voucherId: input.voucherId,
          voucherVersion: input.voucherVersion,
          installmentNumber: input.installmentNumber,
          principalConfirmed: input.principalConfirmed,
          note: input.note,
          ...reviewed,
          id: uuidv7(),
          firmId: actor.firmId,
          loanId: id,
          voucherNumber: voucher.number,
          voucherDate: voucher.date,
        })
        .returning();
      const result = await advance(tx, loan, actor.firmId);
      await audit(
        tx,
        actor,
        id,
        "reference-added",
        input.note || "Repayment journal linked",
        { version },
        {
          version: result.version,
          reference,
          sourceValues: {
            accountReduction: amounts.principal,
            separatelyPostedInterest: amounts.interest,
          },
          ...(input.allocation ? { allocation: input.allocation } : {}),
        },
      );
      return result;
    });
  },
  removeReference(
    db: Db,
    actor: LoanActor,
    id: string,
    referenceId: string,
    version: number,
    reason: string,
  ) {
    return write(db, actor, 200, async (tx) => {
      const loan = await readLoan(tx, actor.firmId, id);
      if (loan.version !== version) throw conflict();
      const condition = and(
        eq(loanRepaymentReferences.firmId, actor.firmId),
        eq(loanRepaymentReferences.loanId, id),
        eq(loanRepaymentReferences.id, referenceId),
      );
      const [reference] = await tx
        .select()
        .from(loanRepaymentReferences)
        .where(condition);
      if (!reference || reference.removedAt)
        throw notFound("active repayment reference");
      const [voucher] = await tx
        .select()
        .from(schema.vouchers)
        .where(
          and(
            eq(schema.vouchers.firmId, actor.firmId),
            eq(schema.vouchers.id, reference.voucherId),
          ),
        );
      await assertOpenPeriod(tx, actor.firmId, [
        reference.voucherDate,
        voucher?.date ?? reference.voucherDate,
        today(),
      ]);
      const [removed] = await tx
        .update(loanRepaymentReferences)
        .set({ removedAt: new Date() })
        .where(condition)
        .returning();
      const result = await advance(tx, loan, actor.firmId);
      await audit(
        tx,
        actor,
        id,
        "reference-removed",
        reason,
        { version, reference },
        { version: result.version, reference: removed },
      );
      return result;
    });
  },
};
