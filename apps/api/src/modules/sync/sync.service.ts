import { createHash } from "node:crypto";
import { can, type Permission, type Role } from "@repo/core";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import type {
  SyncApplied,
  SyncChange,
  SyncChanges,
  SyncConflict,
  SyncEntity,
  SyncPushMutation,
  SyncPushResult,
} from "@repo/contracts";
import {
  isDurableRequestId,
  SYNC_CURSOR_RESET,
  VoucherType,
} from "@repo/contracts";
import { sql } from "drizzle-orm";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { bookControlError } from "../../lib/book-errors";
import {
  canReadBooks,
  canReadParty,
  canReadVoucher,
  ledgerForRead,
} from "../../lib/read-permissions";
import { toItemRow } from "../masters/items.service";
import { toLedgerRow } from "../masters/ledgers.service";
import { toPartyRow } from "../masters/parties.service";
import { unknownRetry } from "@repo/backend/modules/vouchers/idempotency";
import { itemsService } from "../masters/items.service";
import { ledgersService } from "../masters/ledgers.service";
import { partiesService } from "../masters/parties.service";
import { authorizePartyWrite } from "../masters/parties.permissions";
import { toStoredDocument } from "../documents/documents.service";
import { documentsRepo } from "../documents/documents.repo";
import {
  requireRight,
  vouchersService,
  type Ctx as VoucherCtx,
} from "../vouchers/vouchers.service";
import { syncRepo, type ChangeRow } from "./sync.repo";
import { readAccount } from "@repo/backend/modules/accounts/accountMasters";

type PushEntity = SyncPushMutation["entity"];
type MasterEntity = Exclude<PushEntity, "voucher">;
type PushCtx = {
  firmId: string;
  userId: string;
  userName: string;
  role: Role;
};
type StoredPushResult = SyncApplied | SyncConflict;

const writeRights: Record<MasterEntity, Permission[]> = {
  party: ["sales", "purchase"],
  item: ["sales", "purchase"],
  ledger: ["payments"],
};

function requestHash(firmId: string, mutation: SyncPushMutation) {
  return createHash("sha256")
    .update(JSON.stringify([firmId, "sync/push", mutation]))
    .digest("hex");
}

function mutationKey(mutation: SyncPushMutation) {
  return `sync:${mutation.clientMutationId}`;
}

function ensureRight(role: Role, entity: MasterEntity) {
  if (writeRights[entity].some((permission) => can(role, permission))) return;
  throw new AppError(
    "FORBIDDEN",
    "Your role can't sync this change. Ask the owner of the firm.",
    403,
  );
}

function conflictOf(
  mutation: SyncPushMutation,
  error: AppError,
  current: unknown,
): SyncConflict {
  const id = "id" in mutation ? mutation.id : undefined;
  const draftId = "draftId" in mutation ? mutation.draftId : undefined;
  return {
    clientMutationId: mutation.clientMutationId,
    entity: mutation.entity,
    ...(id ? { id } : {}),
    ...(draftId ? { draftId } : {}),
    code: error.code,
    message: error.message,
    current,
  };
}

function appliedOf(
  mutation: SyncPushMutation,
  id: string,
  record: unknown,
): SyncApplied {
  const draftId = "draftId" in mutation ? mutation.draftId : undefined;
  return {
    clientMutationId: mutation.clientMutationId,
    entity: mutation.entity,
    operation: mutation.operation,
    id,
    ...(draftId ? { draftId } : {}),
    record,
  };
}

async function replay(
  db: Db,
  userId: string,
  key: string,
  hash: string,
): Promise<StoredPushResult | undefined> {
  return (await syncRepo.replayMutation(db, userId, key, hash)) as
    StoredPushResult | undefined;
}

async function remember(
  db: Db,
  userId: string,
  key: string,
  hash: string,
  result: StoredPushResult,
) {
  await syncRepo.rememberMutation(db, userId, key, hash, result);
}

async function liveRecord(
  db: Db,
  firmId: string,
  entity: PushEntity,
  role: Role,
  id?: string,
) {
  if (!id) return null;
  if (entity === "voucher") {
    const type = await syncRepo.voucherType(db, firmId, id);
    if (!type || !canReadVoucher(role, type)) return null;
    return vouchersService.get(db, firmId, id);
  }
  if (entity === "party") {
    const row = await syncRepo.party(db, firmId, id);
    return row && !row.deletedAt && canReadParty(role, row.type)
      ? toPartyRow({ ...row, balance: "0" })
      : null;
  }
  if (entity === "item") {
    const row = await syncRepo.item(db, firmId, id);
    return row && !row.deletedAt ? toItemRow({ ...row, stock: "0" }) : null;
  }
  const row = await syncRepo.ledger(db, firmId, id);
  return row && !row.deletedAt
    ? ledgerForRead(role, toLedgerRow({ ...row, balance: "0" }))
    : null;
}

function readablePushRecord(role: Role, entity: PushEntity, record: unknown) {
  if (record === null || canReadBooks(role))
    return associatePayloadForRead(role, record);
  if (!record || typeof record !== "object") return null;
  if (entity === "item") return record;
  if (entity === "voucher" && "type" in record) {
    const type = VoucherType.safeParse(record.type);
    return type.success && canReadVoucher(role, type.data)
      ? associatePayloadForRead(role, record)
      : null;
  }
  if (entity === "party" && "type" in record)
    return record.type === "customer" && canReadParty(role, record.type)
      ? record
      : null;
  if (
    entity === "ledger" &&
    "openingBalance" in record &&
    "balance" in record &&
    typeof record.openingBalance === "number" &&
    typeof record.balance === "number"
  )
    return ledgerForRead(
      role,
      record as { openingBalance: number; balance: number },
    );
  return null;
}

// A retry may contain a result saved before a role downgrade; authorize it again today.
export function readablePushResult(
  role: Role,
  result: StoredPushResult,
): StoredPushResult {
  if ("code" in result)
    return {
      ...result,
      current:
        result.code === "FORBIDDEN"
          ? null
          : readablePushRecord(role, result.entity, result.current),
    };
  return {
    ...result,
    record: readablePushRecord(role, result.entity, result.record),
  };
}

async function changedRecord(db: Db, firmId: string, change: ChangeRow) {
  if (change.action === "deleted") return null;
  switch (change.entity satisfies SyncEntity) {
    case "account":
      return readAccount(db, firmId, change.entityId);
    case "party": {
      const row = await syncRepo.party(db, firmId, change.entityId);
      return row && !row.deletedAt
        ? toPartyRow({ ...row, balance: "0" })
        : null;
    }
    case "item": {
      const row = await syncRepo.item(db, firmId, change.entityId);
      return row && !row.deletedAt ? toItemRow({ ...row, stock: "0" }) : null;
    }
    case "ledger": {
      const row = await syncRepo.ledger(db, firmId, change.entityId);
      return row && !row.deletedAt
        ? toLedgerRow({ ...row, balance: "0" })
        : null;
    }
    case "voucher":
      return vouchersService.get(db, firmId, change.entityId);
    case "document": {
      const row = await syncRepo.document(db, firmId, change.entityId);
      return row && !row.deletedAt && row.readyAt
        ? toStoredDocument(row)
        : null;
    }
    case "firm-profile":
      return syncRepo.firmProfile(db, firmId);
    case "invoice-settings":
      return syncRepo.invoiceSettings(db, firmId);
    case "reminder-settings":
      return syncRepo.reminderSettings(db, firmId);
  }
}

async function toChange(
  db: Db,
  firmId: string,
  change: ChangeRow,
  role: Role,
): Promise<SyncChange> {
  const record = await changedRecord(db, firmId, change);
  return {
    seq: change.seq,
    entity: change.entity,
    id: change.entityId,
    action: change.action,
    changedAt: change.changedAt.toISOString(),
    record:
      change.entity === "ledger" && record
        ? ledgerForRead(role, record as ReturnType<typeof toLedgerRow>)
        : associatePayloadForRead(role, record),
  };
}

// Decide visibility before hydration, including tombstones whose masters are soft-deleted.
async function canReadChange(
  db: Db,
  firmId: string,
  change: ChangeRow,
  role: Role,
) {
  if (canReadBooks(role)) return true;
  switch (change.entity) {
    case "party": {
      const row = await syncRepo.party(db, firmId, change.entityId);
      return !!row && canReadParty(role, row.type);
    }
    case "voucher": {
      const type = await syncRepo.voucherType(db, firmId, change.entityId);
      return !!type && canReadVoucher(role, type);
    }
    case "document": {
      return documentsRepo.canRead(db, firmId, change.entityId, role);
    }
    case "item":
    case "ledger":
    case "firm-profile":
    case "invoice-settings":
      return true;
    default:
      return false;
  }
}

async function applyMutation(
  db: Db,
  ctx: PushCtx,
  mutation: SyncPushMutation,
): Promise<SyncApplied> {
  if (mutation.entity === "voucher") {
    const record =
      mutation.operation === "create"
        ? await createVoucher(db, ctx, mutation)
        : await changeVoucher(db, ctx, mutation);
    return appliedOf(mutation, record.id, record);
  }
  ensureRight(ctx.role, mutation.entity);
  if (mutation.entity === "party") {
    if (mutation.operation === "create") {
      const record = await partiesService.create(
        db,
        ctx.firmId,
        mutation.data,
        ctx.role,
      );
      return appliedOf(mutation, record.id, record);
    }
    if (mutation.operation === "update") {
      const record = await partiesService.update(
        db,
        ctx.firmId,
        mutation.id,
        mutation.baseVersion,
        mutation.data,
        ctx.role,
      );
      return appliedOf(mutation, mutation.id, record);
    }
    await partiesService.remove(
      db,
      ctx.firmId,
      mutation.id,
      mutation.baseVersion,
      ctx.role,
    );
    return appliedOf(mutation, mutation.id, null);
  }
  if (mutation.entity === "item") {
    if (mutation.operation === "create") {
      const record = await itemsService.create(db, ctx.firmId, mutation.data);
      return appliedOf(mutation, record.id, record);
    }
    if (mutation.operation === "update") {
      const record = await itemsService.update(
        db,
        ctx.firmId,
        mutation.id,
        mutation.baseVersion,
        mutation.data,
      );
      return appliedOf(mutation, mutation.id, record);
    }
    await itemsService.remove(
      db,
      ctx.firmId,
      mutation.id,
      mutation.baseVersion,
    );
    return appliedOf(mutation, mutation.id, null);
  }
  if (mutation.operation === "create") {
    const record = await ledgersService.create(db, ctx.firmId, mutation.data);
    return appliedOf(mutation, record.id, record);
  }
  if (mutation.operation === "update") {
    const record = await ledgersService.update(
      db,
      ctx.firmId,
      mutation.id,
      mutation.baseVersion,
      mutation.data,
    );
    return appliedOf(mutation, mutation.id, record);
  }
  await ledgersService.remove(
    db,
    ctx.firmId,
    mutation.id,
    mutation.baseVersion,
  );
  return appliedOf(mutation, mutation.id, null);
}

async function pushOne(
  db: Db,
  ctx: PushCtx,
  mutation: SyncPushMutation,
): Promise<StoredPushResult> {
  const key = mutationKey(mutation);
  const hash = requestHash(ctx.firmId, mutation);
  return db.transaction(async (tx) => {
    const lockedDb = tx as unknown as Db;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${ctx.userId + ":" + key}))`,
    );

    let result: StoredPushResult;
    try {
      if (mutation.entity === "party") {
        // Keep the saved type stable through permission checks, replay and mutation.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${ctx.firmId}, 0))`,
        );
        await authorizePartyWrite(
          tx,
          ctx.firmId,
          ctx.role,
          "data" in mutation ? mutation.data.type : undefined,
          "id" in mutation ? mutation.id : undefined,
        );
      }
      const replayed = await replay(lockedDb, ctx.userId, key, hash);
      if (replayed) return replayed;
      // Older cleanup could remove the envelope while retaining the original voucher.
      if (mutation.entity === "voucher") {
        const saved = await syncRepo.replayMutation(
          lockedDb,
          ctx.userId,
          `voucher-sync:${mutation.clientMutationId}`,
          hash,
        );
        if (saved) {
          const voucher = saved as { id: string };
          const recovered = appliedOf(mutation, voucher.id, saved);
          await remember(lockedDb, ctx.userId, key, hash, recovered);
          return recovered;
        }
      }
      if (!isDurableRequestId(mutation.clientMutationId)) throw unknownRetry();
      // A failed database statement must roll back before reading the conflict record.
      result = await tx.transaction((inner) =>
        applyMutation(inner as unknown as Db, ctx, mutation),
      );
    } catch (err) {
      const failure = err instanceof AppError ? err : bookControlError(err);
      if (!failure) throw err;
      const id = "id" in mutation ? mutation.id : undefined;
      const current =
        failure.code === "FORBIDDEN"
          ? null
          : await liveRecord(
              lockedDb,
              ctx.firmId,
              mutation.entity,
              ctx.role,
              id,
            );
      result = conflictOf(mutation, failure, current);
      // Rejections of an occupied/unknown key must never replace its original identity.
      if (
        ["FORBIDDEN", "KEY_REUSED", "RETRY_RESULT_UNKNOWN"].includes(
          failure.code,
        )
      )
        return result;
    }
    await remember(lockedDb, ctx.userId, key, hash, result);
    return result;
  });
}

function voucherCtx(ctx: PushCtx, mutation: SyncPushMutation): VoucherCtx {
  return {
    id: ctx.userId,
    name: ctx.userName,
    firmId: ctx.firmId,
    role: ctx.role,
    idem: {
      key: `voucher-sync:${mutation.clientMutationId}`,
      hash: requestHash(ctx.firmId, mutation),
    },
  };
}

async function createVoucher(
  db: Db,
  ctx: PushCtx,
  mutation: Extract<
    SyncPushMutation,
    { entity: "voucher"; operation: "create" }
  >,
) {
  requireRight(ctx.role, mutation.voucherType);
  const vctx = voucherCtx(ctx, mutation);
  switch (mutation.voucherType) {
    case "sale":
      return vouchersService.sale(db, vctx, mutation.data);
    case "purchase":
      return vouchersService.purchase(db, vctx, mutation.data);
    case "receipt":
      return vouchersService.receipt(db, vctx, mutation.data);
    case "payment":
      return vouchersService.payment(db, vctx, mutation.data);
    case "expense":
      return vouchersService.expense(db, vctx, mutation.data);
    case "journal":
      return vouchersService.journal(db, vctx, mutation.data);
    case "contra":
      return vouchersService.contra(db, vctx, mutation.data);
    case "estimate":
    case "sales-order":
    case "delivery-note":
    case "purchase-order":
      return vouchersService.order(
        db,
        vctx,
        mutation.voucherType,
        mutation.data,
      );
    case "credit-note":
    case "debit-note":
      return vouchersService.note(
        db,
        vctx,
        mutation.voucherType,
        mutation.data,
      );
  }
}

async function changeVoucher(
  db: Db,
  ctx: PushCtx,
  mutation: Extract<
    SyncPushMutation,
    { entity: "voucher"; operation: "update" | "cancel" }
  >,
) {
  const vctx = voucherCtx(ctx, mutation);
  if (mutation.operation === "update")
    return vouchersService.edit(
      db,
      vctx,
      mutation.id,
      mutation.baseVersion,
      mutation.data,
    );
  return vouchersService.cancel(
    db,
    vctx,
    mutation.id,
    mutation.baseVersion,
    mutation.data.reason,
  );
}

export const syncService = {
  async pull(
    db: Db,
    firmId: string,
    params: { since: number; limit: number },
    role: Role,
  ): Promise<SyncChanges> {
    if (params.since > (await syncRepo.latestCursor(db, firmId)))
      throw new AppError(
        SYNC_CURSOR_RESET,
        "This sync cursor is ahead of the available books. Preserve pending entries and reconcile them before rebuilding the local read cache.",
        409,
      );
    const rows = await syncRepo.changes(db, firmId, params.since, params.limit);
    const page = rows.slice(0, params.limit);
    const items: SyncChange[] = [];
    for (const change of page) {
      if (await canReadChange(db, firmId, change, role))
        items.push(await toChange(db, firmId, change, role));
    }
    return {
      items,
      // Advance past hidden rows too, so a restricted page cannot stall synchronization.
      nextCursor: page.at(-1)?.seq ?? params.since,
      hasMore: rows.length > params.limit,
    };
  },

  async push(
    db: Db,
    ctx: PushCtx,
    mutations: SyncPushMutation[],
  ): Promise<SyncPushResult> {
    const applied: SyncApplied[] = [];
    const conflicts: SyncConflict[] = [];
    for (const mutation of mutations) {
      const result = readablePushResult(
        ctx.role,
        await pushOne(db, ctx, mutation),
      );
      if ("code" in result) conflicts.push(result);
      else applied.push(result);
    }
    return { applied, conflicts };
  },
};
