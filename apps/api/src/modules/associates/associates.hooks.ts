import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { bookScopeOf, type Voucher } from "@repo/core";
import {
  associatePayloadForRead,
  commissionLines,
  returnedCommission,
  returnedQuantityFor,
} from "@repo/core/src/accounting/associates";
import * as c from "@repo/contracts/src/associates";
import { schema } from "@repo/backend/db/client";
import {
  associateRules,
  commissionAccruals,
  commissionEntries,
  deliveryAssignments,
} from "@repo/backend/db/schema/associates";
import { hydrateVouchers, type Snapshot } from "@repo/backend/modules/vouchers/snapshot";
import type { Saved } from "@repo/backend/modules/vouchers/persist";
import { postAssociateJournal } from "./associates.journals";
import {
  invalid,
  readAssociate,
  requireAssociateWriter,
  type HookActor,
  type Reader,
  type Tx,
} from "./associates.shared";

export type AssociateVoucher = Voucher & {
  delivery?: c.DeliverySnapshot;
  commission?: c.CommissionSnapshot;
};

/** Apply to voucher responses for roles without access to associate accounts. */
export function associateVoucherForRead<T extends AssociateVoucher>(
  role: string,
  voucher: T,
): T {
  if (role === "owner" || role === "accountant") return voucher;
  return associatePayloadForRead(role, voucher);
}

/** Call under the firm write lock before core creation/edit. Never accept snapshots from HTTP. */
export async function prepareInvoiceAssociates(
  db: Reader,
  actor: HookActor,
  raw: c.InvoiceAssociatesInput & { sourceId?: string },
  date: string,
  previous?: AssociateVoucher,
) {
  if (!previous && raw.sourceId) {
    const rows = await db
      .select()
      .from(schema.vouchers)
      .where(
        and(
          eq(schema.vouchers.firmId, actor.firmId),
          eq(schema.vouchers.id, raw.sourceId),
        ),
      );
    previous = (await hydrateVouchers(db, rows))[0];
    if (!previous)
      throw invalid("The source document is not available in this firm.");
  }
  const input = c.InvoiceAssociatesInput.parse(raw);
  let delivery = previous?.delivery;
  let commission = previous?.commission;
  if (input.delivery !== undefined) {
    if (!input.delivery) delivery = undefined;
    else {
      const associate = await readAssociate(
        db,
        actor.firmId,
        input.delivery.associateId,
      );
      if (
        !associate.active ||
        !associate.roles.includes("delivery") ||
        !associate.delivery
      )
        throw invalid("Choose an active delivery associate in this firm.");
      delivery = c.DeliverySnapshot.parse({
        ...input.delivery,
        name: associate.name,
        vehicle: associate.delivery.vehicle,
        printPhone: associate.delivery.printPhone,
        phone: associate.delivery.printPhone ? associate.phone : undefined,
        profileVersion: associate.version,
      });
    }
  }
  if (input.commission !== undefined) {
    await requireAssociateWriter(db, actor.firmId, actor.id);
    if (!input.commission) commission = undefined;
    else {
      const associate = await readAssociate(
        db,
        actor.firmId,
        input.commission.associateId,
      );
      const rule = associate.commission;
      if (
        !associate.active ||
        !associate.roles.includes("commission-partner") ||
        !rule
      )
        throw invalid("Choose an active commission partner in this firm.");
      if (date < rule.effectiveFrom)
        throw invalid(
          "The commission rule is not effective on this sale date.",
        );
      if (
        input.commission.rate !== undefined &&
        input.commission.rate !== rule.rate &&
        !rule.allowOverride
      )
        throw invalid("This commission rule does not allow a rate override.");
      commission = c.CommissionSnapshot.parse({
        ...rule,
        associateId: associate.id,
        name: associate.name,
        ruleVersion: associate.version,
        rate: input.commission.rate ?? rule.rate,
      });
    }
  }
  if (commission && commission.effectiveFrom > date)
    throw invalid(
      "The saved commission rule is not effective on this sale date.",
    );
  if (previous && previous.type !== "sale") {
    if (delivery) {
      const associate = await readAssociate(
        db,
        actor.firmId,
        delivery.associateId,
      );
      if (!associate.active || !associate.roles.includes("delivery"))
        throw invalid(
          "Choose an active delivery associate before converting this document.",
        );
    }
    if (commission) {
      const associate = await readAssociate(
        db,
        actor.firmId,
        commission.associateId,
      );
      if (!associate.active || !associate.roles.includes("commission-partner"))
        throw invalid(
          "Choose an active commission partner before converting this document.",
        );
    }
  }
  return { delivery, commission };
}

async function verifyPolicy(
  tx: Tx,
  firmId: string,
  policy: c.CommissionSnapshot,
) {
  const [rule] = await tx
    .select()
    .from(associateRules)
    .where(
      and(
        eq(associateRules.firmId, firmId),
        eq(associateRules.associateId, policy.associateId),
        eq(associateRules.version, policy.ruleVersion),
      ),
    );
  if (!rule) throw invalid("The saved commission rule is missing.");
  const expected = rule.snapshot;
  if (
    expected.payableAccountId !== policy.payableAccountId ||
    expected.effectiveFrom !== policy.effectiveFrom ||
    JSON.stringify(expected.itemIds) !== JSON.stringify(policy.itemIds) ||
    JSON.stringify(expected.groups) !== JSON.stringify(policy.groups)
  )
    throw invalid(
      "The commission rule snapshot does not match the saved rule.",
    );
}

async function adjust(
  tx: Tx,
  actor: HookActor,
  accrual: typeof commissionAccruals.$inferSelect,
  target: number,
  trigger: Voucher,
  version: number,
) {
  const entries = await tx
    .select()
    .from(commissionEntries)
    .where(
      and(
        eq(commissionEntries.firmId, actor.firmId),
        eq(commissionEntries.accrualId, accrual.id),
      ),
    );
  const current = Number(
    entries
      .filter((e) => e.kind === "earned" || e.kind === "adjustment")
      .reduce((s, e) => s + BigInt(e.amount), 0n),
  );
  if (!Number.isSafeInteger(current))
    throw invalid("Commission balance is too large.");
  const amount = target - current;
  if (!amount) return;
  const eventKey = `adjust:${trigger.id}:${version}:${accrual.id}`;
  if (entries.some((e) => e.eventKey === eventKey))
    throw invalid("This source revision has already adjusted the commission.");
  const description = `Commission adjustment for ${trigger.number}`;
  const journalId = await postAssociateJournal(tx, actor, {
    ...accrual.snapshot,
    bookScope: accrual.bookScope,
    date: trigger.date,
    amount,
    sourceVoucherId: trigger.id,
    description,
  });
  await tx.insert(commissionEntries).values({
    id: uuidv7(),
    firmId: actor.firmId,
    associateId: accrual.associateId,
    accrualId: accrual.id,
    sourceVoucherId: trigger.id,
    journalId,
    eventKey,
    date: trigger.date,
    bookScope: accrual.bookScope,
    kind: "adjustment",
    amount,
    description,
  });
}

function economicState(v: AssociateVoucher) {
  return JSON.stringify({
    date: v.date,
    status: v.status,
    lines: v.lines,
    bookScope: v.bookScope,
    commission: v.commission,
  });
}

async function syncDelivery(
  tx: Tx,
  actor: HookActor,
  voucher: AssociateVoucher,
) {
  if (voucher.type !== "sale" && voucher.type !== "delivery-note") return;
  const [active] = await tx
    .select()
    .from(deliveryAssignments)
    .where(
      and(
        eq(deliveryAssignments.firmId, actor.firmId),
        eq(deliveryAssignments.voucherId, voucher.id),
        eq(deliveryAssignments.active, true),
      ),
    );
  if (
    active &&
    voucher.status === "posted" &&
    JSON.stringify(active.snapshot) === JSON.stringify(voucher.delivery)
  )
    return;
  if (active)
    await tx
      .update(deliveryAssignments)
      .set({ active: false, version: active.version + 1 })
      .where(eq(deliveryAssignments.id, active.id));
  if (voucher.status === "posted" && voucher.delivery) {
    await tx.insert(deliveryAssignments).values({
      id: uuidv7(),
      firmId: actor.firmId,
      associateId: voucher.delivery.associateId,
      voucherId: voucher.id,
      voucherNumber: voucher.number,
      date: voucher.date,
      snapshot: voucher.delivery,
      statusDate: voucher.date,
    });
  }
}

/** Call after saveChanges and before rememberAnswer, in the same transaction and firm lock. */
export async function syncAssociateVouchers(
  tx: Tx,
  actor: HookActor,
  snap: Snapshot,
  saved: Saved,
) {
  const changed = snap.books.vouchers.filter((v) => saved.versions.has(v.id));
  for (const raw of changed) {
    const voucher: AssociateVoucher = {
      ...raw,
      id: saved.idOf(raw.id),
      againstId: raw.againstId ? saved.idOf(raw.againstId) : undefined,
    };
    const version = saved.versions.get(raw.id);
    if (version === undefined)
      throw new Error("Saved voucher version is missing.");
    await syncDelivery(tx, actor, voucher);
    if (voucher.type !== "sale" && voucher.type !== "credit-note") continue;
    const saleId = voucher.type === "sale" ? voucher.id : voucher.againstId;
    if (!saleId) continue;
    const previous = snap.before.get(raw.id);
    if (
      voucher.type === "sale" &&
      previous &&
      economicState(JSON.parse(previous) as AssociateVoucher) ===
        economicState(voucher)
    )
      continue;
    const active = await tx
      .select()
      .from(commissionAccruals)
      .where(
        and(
          eq(commissionAccruals.firmId, actor.firmId),
          eq(commissionAccruals.saleId, saleId),
          eq(commissionAccruals.active, true),
        ),
      );
    if (voucher.type === "sale") {
      // A repeated hook for the same saved revision has no new work.
      if (active.length && active.every((a) => a.saleVersion === version))
        continue;
      for (const accrual of active) {
        await adjust(tx, actor, accrual, 0, voucher, version);
        await tx
          .update(commissionAccruals)
          .set({ active: false })
          .where(eq(commissionAccruals.id, accrual.id));
      }
      if (voucher.status !== "posted" || !voucher.commission) continue;
      await verifyPolicy(tx, actor.firmId, voucher.commission);
      const groups = new Map(
        (voucher.snapshot?.items ?? snap.books.items).map((item) => [
          item.id,
          item.group,
        ]),
      );
      for (const line of commissionLines(
        voucher.lines ?? [],
        voucher.commission,
        groups,
      )) {
        const id = uuidv7();
        const bookScope = bookScopeOf(voucher);
        await tx.insert(commissionAccruals).values({
          id,
          firmId: actor.firmId,
          associateId: line.associateId,
          saleId,
          saleVersion: version,
          lineIndex: line.lineIndex,
          bookScope,
          date: voucher.date,
          quantity: line.quantity,
          basis: line.basis,
          earned: line.earned,
          snapshot: voucher.commission,
        });
        const description = `Commission on ${voucher.number}, line ${line.lineIndex + 1}`;
        const journalId = await postAssociateJournal(tx, actor, {
          ...voucher.commission,
          date: voucher.date,
          bookScope,
          amount: line.earned,
          sourceVoucherId: saleId,
          description,
        });
        await tx.insert(commissionEntries).values({
          id: uuidv7(),
          firmId: actor.firmId,
          associateId: line.associateId,
          accrualId: id,
          sourceVoucherId: saleId,
          journalId,
          eventKey: `earned:${saleId}:${version}:${line.lineIndex}`,
          date: voucher.date,
          bookScope,
          kind: "earned",
          amount: line.earned,
          description,
        });
      }
    } else if (active.length) {
      // Current-period notes read old snapshots but never alter the closed sale or its journal.
      const rows = await tx
        .select()
        .from(schema.vouchers)
        .where(
          and(
            eq(schema.vouchers.firmId, actor.firmId),
            eq(schema.vouchers.againstId, saleId),
            eq(schema.vouchers.type, "credit-note"),
            eq(schema.vouchers.status, "posted"),
          ),
        );
      const notes = await hydrateVouchers(tx, rows);
      for (const accrual of active) {
        const quantity = returnedQuantityFor(saleId, accrual.lineIndex, notes);
        const target =
          accrual.earned -
          returnedCommission(accrual.earned, accrual.quantity, quantity);
        await adjust(tx, actor, accrual, target, voucher, version);
      }
    }
  }
}

/** Used by parent hydration if snapshots are stored outside the voucher header. */
export async function associateJournalIds(
  db: Reader,
  firmId: string,
  ids: string[],
) {
  if (!ids.length) return new Set<string>();
  const { associateJournals } = await import("@repo/backend/db/schema/associates");
  const rows = await db
    .select()
    .from(associateJournals)
    .where(
      and(
        eq(associateJournals.firmId, firmId),
        inArray(associateJournals.journalId, ids),
      ),
    );
  return new Set(rows.map((r) => r.journalId));
}
