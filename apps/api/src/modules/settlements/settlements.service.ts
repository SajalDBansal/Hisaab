import { and, asc, eq, gt } from "drizzle-orm";
import {
  bookScopeOf,
  partyBalance,
  partyBills,
  scopeBooks,
  today,
  type Allocation,
  type Voucher,
} from "@repo/core";
import {
  adjustedAllocations,
  allocationDelta,
  settlementLines,
  sumPaise,
  reverseSettlementLines,
} from "@repo/core/src/accounting/settlements";
import type {
  SettlementInput,
  SettlementContextQuery,
  SettlementQuery,
} from "@repo/contracts/src/settlements";
import { schema, type Db } from "@repo/backend/db/client";
import { loans } from "@repo/backend/db/schema/loans";
import { importedOpeningBillId } from "@repo/core/src/accounting/openingImport";
import {
  partyRefundCapacity,
  partySettlementDates,
} from "@repo/core/src/accounting/refundCapacity";
import {
  settlementEntries,
  settlementAllocations,
} from "@repo/backend/db/schema/settlements";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import {
  hydrateSettlementVouchers,
  invalid,
  postSettlement,
  record,
  required,
  settlementWrite,
  type SettlementActor,
  type SettlementTx,
} from "@repo/backend/modules/settlements/settlements.shared";

async function booksFor(db: Pick<Db, "select">, firmId: string) {
  const books = await loadReportBooks(db, firmId, { includeDeleted: true });
  books.vouchers = await hydrateSettlementVouchers(db, firmId, books.vouchers);
  return books;
}
type Books = Awaited<ReturnType<typeof booksFor>>;

async function sourceState(
  db: Pick<Db, "select">,
  firmId: string,
  source: Voucher,
) {
  const entries = await db
    .select()
    .from(settlementEntries)
    .where(eq(settlementEntries.firmId, firmId));
  const corrections = entries.filter(
    (e) =>
      e.sourceVoucherId === source.id && e.kind === "allocation-correction",
  );
  const deltas = await db
    .select()
    .from(settlementAllocations)
    .where(eq(settlementAllocations.firmId, firmId));
  const correctionIds = new Set(corrections.map((e) => e.id));
  const allocations = adjustedAllocations(
    source.allocations ?? [],
    deltas
      .filter((d) => correctionIds.has(d.entryId))
      .map((d) => ({
        voucherId: d.openingBillId
          ? importedOpeningBillId(d.openingBillId)
          : (d.billId ?? `opening:${d.openingPartyId}`),
        amount: d.amount,
      })),
  );
  const entry = entries.find((e) => e.voucherId === source.id);
  const reversed =
    entry &&
    entries.some((e) => e.kind === "reversal" && e.sourceEntryId === entry.id);
  return {
    allocations,
    revision: corrections.length,
    entry,
    reversed,
    latestDate: corrections.reduce(
      (date, e) => (e.date > date ? e.date : date),
      source.date,
    ),
  };
}

function sameBook(
  books: Books,
  partyId: string,
  ids: string[],
  scope: "gst" | "nongst",
) {
  const party = required(
    books.parties.find((p) => p.id === partyId),
    "Party not found.",
  );
  for (const id of ids) {
    if (id.startsWith("opening-bill:")) {
      const bill = required(
        party.openingBills?.find(
          (b) => importedOpeningBillId(b.id) === id && b.partyId === party.id,
        ),
        "Opening bill not found for this party.",
      );
      if (
        (scope === "gst" ? bill.gstAmount : bill.amount - bill.gstAmount) !==
        bill.amount
      )
        invalid(
          "Split opening bills must be settled through the existing receipt/payment workflow.",
        );
    } else if (id.startsWith("opening:")) {
      if (id !== `opening:${partyId}`)
        invalid("The opening belongs to another party.");
      const gst =
        party.openingGstBalance ??
        (books.firm.gstRegistration === "unregistered"
          ? 0
          : party.openingBalance);
      if (
        (scope === "gst" ? gst : party.openingBalance - gst) !==
        party.openingBalance
      )
        invalid(
          "Split opening balances must be settled through the existing receipt/payment workflow.",
        );
    } else {
      const bill = required(
        books.vouchers.find((v) => v.id === id),
        "Bill not found.",
      );
      if (
        bill.partyId !== partyId ||
        bill.status !== "posted" ||
        bookScopeOf(bill) !== scope
      )
        invalid("Choose posted bills for this party in the selected book.");
    }
  }
}

function validateAllocations(
  books: Books,
  partyId: string,
  date: string,
  scope: "gst" | "nongst",
  next: Allocation[],
  before: Allocation[] = [],
) {
  allocationDelta([], next);
  sameBook(
    books,
    partyId,
    [...before, ...next].map((a) => a.voucherId),
    scope,
  );
  const party = required(
    books.parties.find((p) => p.id === partyId),
    "Party not found.",
  );
  const bills = partyBills(party, books.vouchers, date);
  const currentBills = partyBills(party, books.vouchers, today());
  for (const allocation of next) {
    const bill = bills.find((b) => b.id === allocation.voucherId);
    const current = currentBills.find((b) => b.id === allocation.voucherId);
    const released =
      before.find((a) => a.voucherId === allocation.voucherId)?.amount ?? 0;
    if (
      !bill ||
      !current ||
      allocation.amount > Math.min(bill.pending, current.pending) + released
    )
      invalid(
        "A bill no longer has enough pending balance. Reload before saving.",
        "SETTLEMENT_CONFLICT",
        409,
      );
  }
}

async function partyContext(
  db: Pick<Db, "select">,
  firmId: string,
  input: SettlementContextQuery,
) {
  const books = await booksFor(db, firmId);
  const [row] = await db
    .select()
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.firmId, firmId),
        eq(schema.parties.id, input.partyId),
      ),
    );
  if (!row || row.deletedAt) invalid("Party not found.", "NOT_FOUND", 404);
  const scoped = scopeBooks(books, input.bookScope);
  const party = required(
    scoped.parties.find((p) => p.id === input.partyId),
    "Party not found.",
  );
  return { books, scoped, party, row };
}

export const settlementsService = {
  async list(db: Db, firmId: string, query: SettlementQuery) {
    const rows = await db
      .select()
      .from(settlementEntries)
      .where(
        and(
          eq(settlementEntries.firmId, firmId),
          query.cursor ? gt(settlementEntries.id, query.cursor) : undefined,
          query.partyId
            ? eq(settlementEntries.partyId, query.partyId)
            : undefined,
          query.loanId ? eq(settlementEntries.loanId, query.loanId) : undefined,
        ),
      )
      .orderBy(asc(settlementEntries.id))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map(record);
    return {
      items,
      nextCursor:
        rows.length > query.limit
          ? (items[items.length - 1]?.id ?? null)
          : null,
    };
  },
  async get(db: Db, firmId: string, id: string) {
    const [row] = await db
      .select()
      .from(settlementEntries)
      .where(
        and(eq(settlementEntries.firmId, firmId), eq(settlementEntries.id, id)),
      );
    return record(required(row, "Settlement not found."));
  },
  async context(db: Db, firmId: string, input: SettlementContextQuery) {
    return db.transaction(
      async (tx) => {
        const { books, scoped, party, row } = await partyContext(
          tx,
          firmId,
          input,
        );
        const sources = [];
        const raw = await tx
          .select({ id: schema.vouchers.id, version: schema.vouchers.version })
          .from(schema.vouchers)
          .where(eq(schema.vouchers.firmId, firmId));
        for (const voucher of books.vouchers) {
          if (
            voucher.partyId !== party.id ||
            voucher.status !== "posted" ||
            voucher.date > input.date ||
            bookScopeOf(voucher) !== input.bookScope ||
            voucher.tds?.amount
          )
            continue;
          const state = await sourceState(tx, firmId, voucher);
          const expected = party.type === "customer" ? "receipt" : "payment";
          const advance =
            state.entry?.kind ===
            (party.type === "customer" ? "advance-receipt" : "advance-payment");
          if (state.reversed || (voucher.type !== expected && !advance))
            continue;
          try {
            sameBook(
              books,
              party.id,
              state.allocations.map((a) => a.voucherId),
              input.bookScope,
            );
          } catch {
            continue;
          }
          sources.push({
            id: voucher.id,
            number: voucher.number,
            date: voucher.date,
            amount: voucher.amount,
            version: required(
              raw.find((v) => v.id === voucher.id),
              "Source not found.",
            ).version,
            revision: state.revision,
            allocations: state.allocations,
          });
        }
        return {
          partyId: party.id,
          partyVersion: row.version,
          balance: partyBalance(party, scoped.vouchers, input.date),
          bills: partyBills(party, scoped.vouchers, input.date).map(
            ({ id, number, date, pending }) => ({ id, number, date, pending }),
          ),
          sources,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  async create(db: Db, actor: SettlementActor, input: SettlementInput) {
    return settlementWrite(
      db,
      actor,
      async (tx, role) => {
        const { books, scoped, party, row } = await partyContext(
          tx,
          actor.firmId,
          input,
        );
        if (row.version !== input.partyVersion)
          invalid(
            "Party changed. Reload before saving.",
            "EDITED_ELSEWHERE",
            409,
          );
        const isWriteoff = input.kind.endsWith("writeoff");
        if (isWriteoff && role !== "owner")
          invalid("Only the owner can write off balances.", "FORBIDDEN", 403);
        let before: Allocation[] = [],
          deltas: Allocation[] = [];
        let amount =
          "amount" in input
            ? input.amount
            : sumPaise(input.allocations.map((a) => a.amount));
        let sourceVoucherId: string | null = null;
        if (input.kind === "allocation-correction") {
          const source = required(
            books.vouchers.find((v) => v.id === input.sourceVoucherId),
            "Source not found.",
          );
          const [raw] = await tx
            .select()
            .from(schema.vouchers)
            .where(
              and(
                eq(schema.vouchers.firmId, actor.firmId),
                eq(schema.vouchers.id, source.id),
              ),
            );
          const state = await sourceState(tx, actor.firmId, source);
          const allowed =
            source.type ===
              (party.type === "customer" ? "receipt" : "payment") ||
            state.entry?.kind ===
              (party.type === "customer"
                ? "advance-receipt"
                : "advance-payment");
          if (
            !allowed ||
            source.partyId !== party.id ||
            source.status !== "posted" ||
            state.reversed ||
            source.tds?.amount ||
            source.date > input.date ||
            bookScopeOf(source) !== input.bookScope
          )
            invalid(
              "Choose an unreversed, same-book receipt/payment or advance without TDS.",
            );
          if (
            raw?.version !== input.sourceVersion ||
            state.revision !== input.revision
          )
            invalid(
              "The source settlement changed. Reload before saving.",
              "EDITED_ELSEWHERE",
              409,
            );
          if (input.date < state.latestDate)
            invalid(
              "A correction cannot precede this source's latest correction.",
            );
          if (amount > source.amount)
            invalid("Allocations exceed the source amount.");
          before = state.allocations;
          const extra = sumPaise([
            amount,
            -sumPaise(before.map((a) => a.amount)),
          ]);
          const direction = party.type === "customer" ? 1 : -1;
          for (const cutoff of partySettlementDates(
            party,
            scoped.vouchers,
            input.date,
            today(),
          )) {
            const pending = sumPaise(
              partyBills(party, scoped.vouchers, cutoff).map((b) => b.pending),
            );
            const funding = sumPaise([
              pending,
              -direction * partyBalance(party, scoped.vouchers, cutoff),
            ]);
            if (extra > Math.max(0, funding))
              invalid(
                "The source's remaining funds have been refunded or used elsewhere. Reload before allocating.",
                "SETTLEMENT_CONFLICT",
                409,
              );
          }
          deltas = allocationDelta(before, input.allocations);
          if (!deltas.length) invalid("The allocation has not changed.");
          amount = Math.max(sumPaise(before.map((a) => a.amount)), amount);
          sourceVoucherId = source.id;
          // Reallocation is prospective: neither the original journal nor closed history changes.
          await assertOpenPeriod(tx, actor.firmId, [input.date]);
        }
        if ("allocations" in input) {
          validateAllocations(
            books,
            party.id,
            input.date,
            input.bookScope,
            input.allocations,
            before,
          );
          if (isWriteoff) deltas = input.allocations;
        }
        const sign = party.type === "customer" ? 1 : -1;
        const balances = [input.date, today()].map(
          (date) => sign * partyBalance(party, scoped.vouchers, date),
        );
        if (isWriteoff && amount > Math.max(0, Math.min(...balances)))
          invalid("Write-off exceeds the party's remaining net balance.");
        if (
          input.kind.endsWith("refund") &&
          amount >
            partyRefundCapacity(party, scoped.vouchers, input.date, today())
        )
          invalid("Refund exceeds the party's credit balance in this book.");
        let bank;
        if ("ledgerId" in input) {
          const [ledger] = await tx
            .select()
            .from(schema.ledgers)
            .where(
              and(
                eq(schema.ledgers.firmId, actor.firmId),
                eq(schema.ledgers.id, input.ledgerId),
              ),
            );
          if (!ledger || ledger.deletedAt)
            invalid("Select an active cash or bank account.");
          bank = ledger;
        }
        return postSettlement(
          tx,
          actor,
          {
            kind: input.kind,
            partyId: party.id,
            sourceVoucherId,
            date: input.date,
            bookScope: input.bookScope,
            amount,
            reason: input.reason,
            details: {
              before,
              after: "allocations" in input ? input.allocations : [],
              request: input,
            },
          },
          settlementLines(input.kind, party, amount, bank),
          deltas,
        );
      },
      input.kind.endsWith("writeoff"),
    );
  },
  async reverse(
    db: Db,
    actor: SettlementActor,
    id: string,
    input: {
      date: string;
      bookScope: "gst" | "nongst";
      reason: string;
      version: number;
    },
  ) {
    return settlementWrite(
      db,
      actor,
      async (tx) => {
        const entries = await tx
          .select()
          .from(settlementEntries)
          .where(eq(settlementEntries.firmId, actor.firmId));
        const entry = required(
          entries.find((e) => e.id === id),
          "Settlement not found.",
        );
        if (entry.version !== input.version)
          invalid("Settlement changed.", "EDITED_ELSEWHERE", 409);
        if (entry.kind === "reversal" || entry.kind === "allocation-correction")
          invalid(
            "Use allocation correction to change bill links; a reversal cannot reverse another correction.",
          );
        const reversed = new Set(
          entries
            .filter((e) => e.kind === "reversal")
            .map((e) => e.sourceEntryId),
        );
        const dependents = entries.filter(
          (e) => e.sourceEntryId === id && e.kind !== "reversal",
        );
        if (reversed.has(id) || dependents.some((e) => !reversed.has(e.id)))
          invalid(
            "Reverse dependent payments first. This settlement may already be reversed.",
            "SETTLEMENT_CONFLICT",
            409,
          );
        const dependentIds = new Set(dependents.map((e) => e.id));
        if (
          entries.some(
            (e) =>
              (e.sourceVoucherId === entry.voucherId ||
                dependentIds.has(e.sourceEntryId ?? "")) &&
              e.date > input.date,
          )
        )
          invalid(
            "The reversal cannot precede the latest dependent correction or reversal.",
          );
        if (input.date < entry.date || input.bookScope !== entry.bookScope)
          invalid("Reverse on or after the entry date in the same book.");
        const books = await booksFor(tx, actor.firmId);
        const voucher = required(
          books.vouchers.find((v) => v.id === entry.voucherId),
          "Settlement journal not found.",
        );
        if (voucher.status !== "posted" || !voucher.journalLines?.length)
          invalid("The original journal is not posted.");
        if (
          entry.kind === "advance-receipt" ||
          entry.kind === "advance-payment"
        ) {
          const state = await sourceState(tx, actor.firmId, voucher);
          if (state.allocations.length)
            invalid(
              "Release this advance's bill allocations before reversing it.",
              "SETTLEMENT_CONFLICT",
              409,
            );
          const scoped = scopeBooks(books, entry.bookScope);
          const party = required(
            scoped.parties.find((p) => p.id === entry.partyId),
            "Party not found.",
          );
          const direction = party.type === "customer" ? 1 : -1;
          for (const cutoff of partySettlementDates(
            party,
            scoped.vouchers,
            input.date,
            today(),
          )) {
            const funding = sumPaise([
              ...partyBills(party, scoped.vouchers, cutoff).map(
                (b) => b.pending,
              ),
              -direction * partyBalance(party, scoped.vouchers, cutoff),
            ]);
            if (entry.amount > Math.max(0, funding))
              invalid(
                "This advance's funds have been refunded or allocated. Reverse those movements first.",
                "SETTLEMENT_CONFLICT",
                409,
              );
          }
        }
        const [loan] = entry.loanId
          ? await tx
              .select()
              .from(loans)
              .where(
                and(eq(loans.firmId, actor.firmId), eq(loans.id, entry.loanId)),
              )
          : [];
        if (entry.loanId && (!loan || loan.status !== "active"))
          invalid("Reopen the loan before reversing its interest.");
        const allocations = await tx
          .select()
          .from(settlementAllocations)
          .where(eq(settlementAllocations.entryId, id));
        const result = await postSettlement(
          tx,
          actor,
          {
            kind: "reversal",
            sourceEntryId: id,
            sourceVoucherId: voucher.id,
            partyId: entry.partyId,
            loanId: entry.loanId,
            interestAccountId: entry.interestAccountId,
            installmentNumber: entry.installmentNumber,
            date: input.date,
            bookScope: entry.bookScope,
            amount: entry.amount,
            reason: input.reason,
            details: { original: record(entry) },
          },
          reverseSettlementLines(voucher.journalLines),
          allocations.map((a) => ({
            voucherId: a.openingBillId
              ? importedOpeningBillId(a.openingBillId)
              : (a.billId ?? `opening:${a.openingPartyId}`),
            amount: -a.amount,
          })),
        );
        if (loan)
          await tx
            .update(loans)
            .set({ version: loan.version + 1, updatedAt: new Date() })
            .where(eq(loans.id, loan.id));
        return result;
      },
      true,
    );
  },
};

export { booksFor as settlementBooks };
export type { SettlementTx };
