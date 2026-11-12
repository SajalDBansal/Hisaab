import * as c from "@repo/contracts";
import { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { stockLots } from "@repo/core";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import { operationReceipts } from "@repo/backend/db/schema/operations";
import { AppError } from "@repo/backend/lib/app-error";
import { ledgerForRead, requireVoucherRead } from "../../lib/read-permissions";
import { createAccount } from "@repo/backend/modules/accounts/accountMasters";
import { writeInventoryAdjustment } from "../inventory/inventory.service";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { partiesService } from "../masters/parties.service";
import { authorizePartyWrite } from "../masters/parties.permissions";
import { itemsService, toItemRow } from "../masters/items.service";
import { itemsRepo } from "../masters/items.repo";
import { ledgersService, toLedgerRow } from "../masters/ledgers.service";
import { ledgersRepo } from "../masters/ledgers.repo";
import { readParty } from "../masters/views.service";
import { vouchersService } from "../vouchers/vouchers.service";
import type { OperationActor, OperationRepository } from "./operations.engine";
import { OperationResult, type OperationInput } from "./operations.schema";

async function apply(
  db: Db,
  actor: OperationActor,
  input: OperationInput,
): Promise<unknown> {
  const { body, path, expectedVersion } = input;
  const { firmId, id: userId } = actor;
  if (input.method === "PUT") {
    const [, entity, id] = path.split("/");
    if (!id || expectedVersion === undefined)
      throw new AppError(
        "INVALID_OPERATION",
        "An entry ID and original version are required.",
        400,
      );
    switch (entity) {
      case "vouchers":
        return vouchersService.edit(
          db,
          actor,
          id,
          expectedVersion,
          c.NewInvoiceInput.parse(body),
        );
      case "parties":
        return partiesService.update(
          db,
          firmId,
          id,
          expectedVersion,
          c.PartyInput.parse(body),
          actor.role,
        );
      case "items":
        return itemsService.update(
          db,
          firmId,
          id,
          expectedVersion,
          c.ItemInput.parse(body),
          actor.role,
        );
      case "ledgers":
        return ledgersService.update(
          db,
          firmId,
          id,
          expectedVersion,
          c.LedgerInput.parse(body),
        );
    }
  }
  switch (path) {
    case "/inventory/adjustments":
      return writeInventoryAdjustment(
        db,
        actor,
        InventoryAdjustmentInput.parse(body),
      );
    case "/sales":
      return vouchersService.sale(db, actor, c.NewInvoiceInput.parse(body));
    case "/sales/split":
      return vouchersService.sales(db, actor, c.NewInvoiceInput.parse(body));
    case "/purchases":
      return vouchersService.purchase(db, actor, c.NewInvoiceInput.parse(body));
    case "/receipts":
      return vouchersService.receipt(db, actor, c.NewMoneyInput.parse(body));
    case "/payments":
      return vouchersService.payment(db, actor, c.NewMoneyInput.parse(body));
    case "/expenses":
      return vouchersService.expense(db, actor, c.NewExpenseInput.parse(body));
    case "/journals":
      return vouchersService.journal(db, actor, c.NewJournalInput.parse(body));
    case "/contras":
      return vouchersService.contra(db, actor, c.NewContraInput.parse(body));
    case "/credit-notes":
      return vouchersService.note(
        db,
        actor,
        "credit-note",
        c.NewNoteInput.parse(body),
      );
    case "/debit-notes":
      return vouchersService.note(
        db,
        actor,
        "debit-note",
        c.NewNoteInput.parse(body),
      );
    case "/orders/estimate":
      return vouchersService.order(
        db,
        actor,
        "estimate",
        c.NewOrderInput.parse(body),
      );
    case "/orders/sales-order":
      return vouchersService.order(
        db,
        actor,
        "sales-order",
        c.NewOrderInput.parse(body),
      );
    case "/orders/purchase-order":
      return vouchersService.order(
        db,
        actor,
        "purchase-order",
        c.NewOrderInput.parse(body),
      );
    case "/orders/delivery-note":
      return vouchersService.order(
        db,
        actor,
        "delivery-note",
        c.NewOrderInput.parse(body),
      );
    case "/accounts/masters":
      return createAccount(db, firmId, userId, c.AccountInput.parse(body));
    case "/ledgers":
      return ledgersService.create(db, firmId, c.LedgerInput.parse(body));
    case "/parties":
      return partiesService.create(
        db,
        firmId,
        c.PartyInput.parse(body),
        actor.role,
      );
    case "/items":
      return itemsService.create(
        db,
        firmId,
        c.ItemInput.parse(body),
        actor.role,
      );
  }
  throw new AppError(
    "UNSUPPORTED_OPERATION",
    "This operation cannot be queued.",
    400,
  );
}

async function current(db: Db, actor: OperationActor, input: OperationInput) {
  if (input.path === "/inventory/adjustments") {
    const books = await loadReportBooks(db, actor.firmId);
    const item = books.items.find((row) => row.id === input.body.itemId);
    return item
      ? (stockLots(item, books.vouchers, String(input.body.date)).find(
          (lot) => lot.id === input.body.lotId,
        ) ?? null)
      : null;
  }
  if (input.method !== "PUT") return null;
  const [, entity, id] = input.path.split("/");
  if (!id) return null;
  try {
    switch (entity) {
      case "vouchers":
        await requireVoucherRead(db, actor.firmId, actor.role, id);
        return vouchersService.get(db, actor.firmId, id);
      case "parties":
        return readParty(db, actor.firmId, id, actor.role);
      case "items": {
        const row = await itemsRepo.get(db, actor.firmId, id);
        return row ? toItemRow(row) : null;
      }
      case "ledgers": {
        const row = await ledgersRepo.get(db, actor.firmId, id);
        return row ? ledgerForRead(actor.role, toLedgerRow(row)) : null;
      }
    }
  } catch (error) {
    if (error instanceof AppError && [403, 404].includes(error.status))
      return null;
    throw error;
  }
  return null;
}

export function operationRepository(
  db: Db,
  writers = { apply, current },
): OperationRepository {
  return {
    transaction: (actor, work) =>
      db.transaction(async (tx) => {
        // Same lock as all voucher/master writers. A savepoint rolls back a rejected write,
        // while its definitive conflict receipt is committed by the outer transaction.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${actor.firmId}, 0))`,
        );
        const [membership] = await tx
          .select()
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, actor.firmId),
              eq(schema.member.userId, actor.id),
            ),
          );
        if (!membership || membership.role !== actor.role)
          throw new AppError(
            "ACCESS_CHANGED",
            "The original membership and role must still be active.",
            403,
          );
        return work({
          authorize: async (input) => {
            if (input.path === "/parties" || input.path.startsWith("/parties/"))
              await authorizePartyWrite(
                tx,
                actor.firmId,
                actor.role,
                c.PartyInput.parse(input.body).type,
                input.method === "PUT" ? input.path.split("/")[2] : undefined,
              );
          },
          read: async (key) => {
            const [row] = await tx
              .select()
              .from(operationReceipts)
              .where(
                and(
                  eq(operationReceipts.userId, actor.id),
                  eq(operationReceipts.key, key),
                ),
              );
            if (row)
              return { ...row, result: OperationResult.parse(row.result) };
            const [legacy] = await tx
              .select()
              .from(schema.idempotencyKeys)
              .where(
                and(
                  eq(schema.idempotencyKeys.userId, actor.id),
                  eq(schema.idempotencyKeys.key, key),
                ),
              );
            return legacy
              ? {
                  firmId: null,
                  role: null,
                  requestHash: legacy.requestHash,
                  legacy: 1,
                  result: {
                    state: "committed" as const,
                    response: legacy.response,
                  },
                }
              : undefined;
          },
          save: async (key, receipt) => {
            await tx
              .insert(operationReceipts)
              .values({ userId: actor.id, key, ...receipt });
          },
          apply: (input) =>
            tx.transaction((savepoint) =>
              writers.apply(savepoint as unknown as Db, actor, input),
            ),
          current: (input) =>
            writers.current(tx as unknown as Db, actor, input),
        });
      }),
  };
}
