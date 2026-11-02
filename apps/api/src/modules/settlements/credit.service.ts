import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { createSales, partyBalance, today, updateInvoice } from "@repo/core";
import { NewInvoiceInput, type Voucher } from "@repo/contracts";
import type { CreditApprovalInput } from "@repo/contracts/src/settlements";
import { schema, type Db } from "@repo/backend/db/client";
import {
  creditApprovals,
  creditApprovalUses,
} from "@repo/backend/db/schema/settlements";
import { loadBooks } from "@repo/backend/modules/vouchers/snapshot";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { settlementBooks } from "./settlements.service";
import {
  invalid,
  required,
  settlementWrite,
  type SettlementActor,
  type SettlementTx,
} from "@repo/backend/modules/settlements/settlements.shared";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => key !== "creditOverrideId" && v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export type CreditEditContext = { editVoucherId: string; editVersion: number };
export const creditRequestHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export const saleCreditHash = (
  sale: NewInvoiceInput,
  edit?: CreditEditContext,
) =>
  creditRequestHash(
    edit
      ? { sale: NewInvoiceInput.parse(sale), ...edit }
      : NewInvoiceInput.parse(sale),
  );

/** Internal helper; caller holds the firm lock and has checked current owner membership. */
export async function saveCreditApproval(
  tx: SettlementTx,
  actor: SettlementActor,
  party: typeof schema.parties.$inferSelect,
  projectedBalance: number,
  saleHash: string,
  reason: string,
) {
  if (party.creditLimit <= 0 || projectedBalance <= party.creditLimit)
    invalid("This sale does not need a credit-limit override.");
  const [approval] = await tx
    .insert(creditApprovals)
    .values({
      id: uuidv7(),
      firmId: actor.firmId,
      partyId: party.id,
      partyVersion: party.version,
      saleHash,
      creditLimit: party.creditLimit,
      projectedBalance,
      reason,
      userId: actor.userId,
      userName: actor.userName,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    })
    .returning();
  const saved = required(approval, "Approval was not saved.");
  return {
    ...saved,
    createdAt: saved.createdAt.toISOString(),
    expiresAt: saved.expiresAt.toISOString(),
  };
}

export async function approveSaleCredit(
  db: Db,
  actor: SettlementActor,
  input: CreditApprovalInput,
) {
  return settlementWrite(
    db,
    actor,
    async (tx) => {
      const [party] = await tx
        .select()
        .from(schema.parties)
        .where(
          and(
            eq(schema.parties.firmId, actor.firmId),
            eq(schema.parties.id, input.sale.partyId),
          ),
        );
      if (!party || party.deletedAt || party.type !== "customer")
        invalid("Select an active customer.");
      if (input.sale.date > today())
        invalid("Future sales cannot be authorized.");
      const edit =
        input.editVoucherId && input.editVersion
          ? {
              editVoucherId: input.editVoucherId,
              editVersion: input.editVersion,
            }
          : undefined;
      const snapshot = await loadBooks(
        tx,
        actor.firmId,
        { id: actor.userId, name: actor.userName },
        {
          parties: [party.id],
          items: input.sale.lines.map((l) => l.itemId),
          vouchers: [input.sale.sourceId, edit?.editVoucherId].filter(
            (id): id is string => !!id,
          ),
        },
      );
      const original = edit
        ? snapshot.books.vouchers.find((v) => v.id === edit.editVoucherId)
        : undefined;
      if (
        edit &&
        (!original ||
          original.type !== "sale" ||
          original.status !== "posted" ||
          snapshot.versions.get(edit.editVoucherId) !== edit.editVersion)
      )
        invalid(
          "The reviewed sale changed. Reload it before obtaining approval.",
          "EDITED_ELSEWHERE",
          409,
        );
      await assertOpenPeriod(tx, actor.firmId, [
        input.sale.date,
        ...(original ? [original.date] : []),
      ]);
      try {
        if (edit)
          updateInvoice(
            snapshot.books,
            edit.editVoucherId,
            input.sale,
            new Date().toISOString(),
          );
        else createSales(snapshot.books, input.sale);
      } catch (error) {
        invalid(error instanceof Error ? error.message : "Invalid sale.");
      }
      const projectedBalance = partyBalance(
        required(
          snapshot.books.parties.find((p) => p.id === party.id),
          "Customer not found.",
        ),
        snapshot.books.vouchers,
        today(),
      );
      return saveCreditApproval(
        tx,
        actor,
        party,
        projectedBalance,
        saleCreditHash(input.sale, edit),
        input.reason,
      );
    },
    true,
  );
}

/** Call after saveChanges, before committing the same firm-locked sale transaction. */
export async function enforceSaleCredit(
  tx: SettlementTx,
  ctx: { firmId: string; id: string },
  input: NewInvoiceInput & { creditOverrideId?: string },
  saved: Voucher[],
  edit?: CreditEditContext,
) {
  return enforceCreditForPostedSales(
    tx,
    ctx,
    {
      partyId: input.partyId,
      creditOverrideId: input.creditOverrideId,
      saleHash: saleCreditHash(input, edit),
    },
    saved,
  );
}

/** Shared by ordinary, edited, split and frozen-order sales inside their posting transaction. */
export async function enforceCreditForPostedSales(
  tx: SettlementTx,
  ctx: { firmId: string; id: string },
  input: { partyId: string; creditOverrideId?: string; saleHash: string },
  saved: Voucher[],
) {
  const sales = saved.filter((v) => v.type === "sale" && v.status === "posted");
  if (!sales.length) return;
  if (sales.some((v) => v.partyId !== input.partyId))
    invalid("Credit approval customer mismatch.");
  const priorUses = await tx
    .select({ partyId: creditApprovals.partyId })
    .from(creditApprovalUses)
    .innerJoin(
      creditApprovals,
      eq(creditApprovals.id, creditApprovalUses.approvalId),
    )
    .where(
      and(
        eq(creditApprovalUses.firmId, ctx.firmId),
        inArray(
          creditApprovalUses.voucherId,
          sales.map((v) => v.id),
        ),
      ),
    );
  if (priorUses.some((use) => use.partyId !== input.partyId))
    invalid(
      "The customer cannot change on a credit-authorized sale. Cancel and recreate the sale.",
      "CREDIT_APPROVAL_STALE",
      409,
    );
  const [member] = await tx
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, ctx.firmId),
        eq(schema.member.userId, ctx.id),
      ),
    )
    .for("share");
  if (!member || !["owner", "accountant", "sales"].includes(member.role))
    invalid("Your role can no longer post sales.", "FORBIDDEN", 403);
  const [party] = await tx
    .select()
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.firmId, ctx.firmId),
        eq(schema.parties.id, input.partyId),
      ),
    );
  if (!party || party.deletedAt) invalid("Customer not found.");
  // Without a limit there is nothing to enforce; skip reloading the whole book.
  if (!party.creditLimit) return;
  const books = await settlementBooks(tx, ctx.firmId);
  const balance = partyBalance(
    required(
      books.parties.find((p) => p.id === party.id),
      "Customer not found.",
    ),
    books.vouchers,
    today(),
  );
  if (!party.creditLimit || balance <= party.creditLimit) return;
  const [approval] = input.creditOverrideId
    ? await tx
        .select()
        .from(creditApprovals)
        .where(
          and(
            eq(creditApprovals.firmId, ctx.firmId),
            eq(creditApprovals.id, input.creditOverrideId),
          ),
        )
    : [];
  if (!approval)
    invalid(
      "This sale exceeds the customer credit limit. Obtain an owner approval for this exact sale.",
      "CREDIT_LIMIT_EXCEEDED",
      409,
    );
  const [owner] = await tx
    .select()
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, ctx.firmId),
        eq(schema.member.userId, approval.userId),
      ),
    )
    .for("share");
  if (
    owner?.role !== "owner" ||
    approval.partyId !== party.id ||
    approval.partyVersion !== party.version ||
    approval.expiresAt.getTime() < Date.now() ||
    approval.saleHash !== input.saleHash ||
    balance > approval.projectedBalance
  )
    invalid(
      "The credit approval is expired or no longer matches this sale and customer balance.",
      "CREDIT_APPROVAL_STALE",
      409,
    );
  const used = await tx
    .select()
    .from(creditApprovalUses)
    .where(eq(creditApprovalUses.approvalId, approval.id));
  if (used.length)
    invalid(
      "This credit approval has already been used.",
      "CREDIT_APPROVAL_USED",
      409,
    );
  await tx.insert(creditApprovalUses).values(
    sales.map((v) => ({
      id: uuidv7(),
      firmId: ctx.firmId,
      approvalId: approval.id,
      voucherId: v.id,
      userId: ctx.id,
    })),
  );
}
