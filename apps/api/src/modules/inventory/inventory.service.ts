import { and, eq } from "drizzle-orm";
import { Voucher } from "@repo/contracts";
import type { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { createInventoryJournal } from "@repo/core";
import {
  prepareStockAdjustment,
  prepareStockReversal,
} from "@repo/core/src/accounting/inventoryAdjustments";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { rememberAnswer, replayOf, type Idem } from "@repo/backend/modules/vouchers/idempotency";
import { loadBooks } from "@repo/backend/modules/vouchers/snapshot";
import { saveChanges } from "@repo/backend/modules/vouchers/persist";

type Actor = { firmId: string; id: string; name: string; idem?: Idem };
type Reversal = { id: string; date: string; reason: string };

/** The expected stock, journal and lot movement commit under one firm lock. */
export function writeInventoryAdjustment(
  db: Db,
  actor: Actor,
  input?: InventoryAdjustmentInput,
  reversal?: Reversal,
) {
  return withFirmWrite(db, actor.firmId, async (tx) => {
    const [member] = await tx
      .select()
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, actor.firmId),
          eq(schema.member.userId, actor.id),
        ),
      );
    if (!member || !["owner", "accountant"].includes(member.role))
      throw new AppError(
        "FORBIDDEN",
        "Only an owner or accountant can correct stock.",
        403,
      );
    if (actor.idem) {
      const replay = await replayOf<Voucher>(tx, actor.id, actor.idem);
      if (replay) return replay;
    }
    const snap = await loadBooks(tx, actor.firmId, actor, {
      items: input ? [input.itemId] : undefined,
      vouchers: reversal ? [reversal.id] : undefined,
    });
    if (input && snap.deleted.has(input.itemId))
      throw new AppError("ITEM_DELETED", "Choose an active item.", 400);
    if (
      input?.offsetAccount?.startsWith("ledger:") &&
      snap.deleted.has(input.offsetAccount.slice(7))
    )
      throw new AppError("LEDGER_DELETED", "Choose an active ledger.", 400);
    let prepared;
    try {
      if (input) prepared = prepareStockAdjustment(snap.books, input);
      else {
        const original = snap.books.vouchers.find(
          (row) => row.id === reversal?.id,
        );
        if (!original || !reversal)
          throw new Error("Inventory adjustment not found.");
        prepared = prepareStockReversal(
          snap.books,
          original,
          reversal.date,
          reversal.reason,
        );
      }
    } catch (error) {
      throw new AppError(
        "INVALID_STOCK_ADJUSTMENT",
        error instanceof Error ? error.message : "Invalid adjustment.",
        409,
      );
    }
    const voucher = createInventoryJournal(
      snap.books,
      prepared.journal,
      prepared.movement,
    );
    const saved = await saveChanges(tx, actor.firmId, actor, snap);
    const result = Voucher.parse({
      ...voucher,
      id: saved.idOf(voucher.id),
      version: saved.versions.get(voucher.id) ?? 1,
    });
    if (actor.idem) await rememberAnswer(tx, actor.id, actor.idem, 201, result);
    return result;
  });
}
