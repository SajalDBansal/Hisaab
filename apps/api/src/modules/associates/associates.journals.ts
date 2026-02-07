import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { commissionJournalLines } from "@repo/core/src/accounting/associates";
import { createJournal, type BookScope } from "@repo/core";
import { associateJournals } from "@repo/backend/db/schema/associates";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { AppError } from "@repo/backend/lib/app-error";
import { loadBooks } from "@repo/backend/modules/vouchers/snapshot";
import { saveChanges } from "@repo/backend/modules/vouchers/persist";
import type { HookActor, Reader, Tx } from "./associates.shared";

export async function assertAssociateJournalEditable(
  db: Reader,
  firmId: string,
  voucherId: string,
) {
  const [link] = await db
    .select()
    .from(associateJournals)
    .where(
      and(
        eq(associateJournals.firmId, firmId),
        eq(associateJournals.journalId, voucherId),
      ),
    );
  if (link)
    throw new AppError(
      "SYSTEM_MANAGED",
      "Correct this commission through its sale, return or associate payout.",
      409,
    );
}

export async function postAssociateJournal(
  tx: Tx,
  actor: HookActor,
  input: {
    date: string;
    bookScope: BookScope;
    payableAccountId: string;
    name: string;
    amount: number;
    sourceVoucherId?: string;
    payoutId?: string;
    description: string;
    bank?: { id: string; name: string };
  },
) {
  if (!input.amount) return null;
  await assertOpenPeriod(tx, actor.firmId, [input.date]);
  const lines = commissionJournalLines(
    input.payableAccountId,
    input.name,
    input.amount,
    input.bank,
  );
  // Reload counters after each journal saved in this transaction. Do not recurse through change().
  const snap = await loadBooks(tx, actor.firmId, actor, {});
  const voucher = createJournal(snap.books, {
    date: input.date,
    bookScope: input.bookScope,
    lines,
    narration: input.description,
  });
  const saved = await saveChanges(tx, actor.firmId, actor, snap);
  const id = saved.idOf(voucher.id);
  await tx.insert(associateJournals).values({
    id: uuidv7(),
    firmId: actor.firmId,
    journalId: id,
    sourceVoucherId: input.sourceVoucherId ?? null,
    payoutId: input.payoutId ?? null,
    purpose: input.description,
  });
  return id;
}
