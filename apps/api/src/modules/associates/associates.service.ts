import { and, asc, desc, eq, gt, ilike, inArray, lte, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { acc, checkVoucherDate, today } from "@repo/core";
import { commissionStatement } from "@repo/core/src/accounting/associates";
import * as c from "@repo/contracts/src/associates";
import { schema, type Db } from "@repo/backend/db/client";
import * as t from "@repo/backend/db/schema/associates";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { notFound } from "@repo/backend/modules/masters/shared";
import {
  associateAudit,
  associateWrite,
  conflict,
  invalid,
  readAssociate,
  record,
  scoped,
  type AssociateActor,
  type Reader,
  type Tx,
} from "./associates.shared";
import { validateAssociateFields } from "./associates.validation";
import { postAssociateJournal } from "./associates.journals";

const fields = async (db: Reader, firmId: string) =>
  (
    await db
      .select()
      .from(t.associateFields)
      .where(eq(t.associateFields.firmId, firmId))
      .orderBy(asc(t.associateFields.id))
  ).map((r) =>
    c.AssociateField.parse({ ...r.definition, id: r.id, version: r.version }),
  );
const hookActor = (actor: AssociateActor) => ({
  firmId: actor.firmId,
  id: actor.userId,
  name: actor.userName,
});
const total = (amounts: number[]) => {
  const value = Number(amounts.reduce((s, a) => s + BigInt(a), 0n));
  if (!Number.isSafeInteger(value)) throw invalid("The total is too large.");
  return value;
};

async function validateProfile(
  tx: Tx,
  firmId: string,
  input: c.AssociateInput,
  previous?: c.AssociateRecord,
) {
  try {
    validateAssociateFields(await fields(tx, firmId), input.fields);
  } catch (error) {
    throw invalid((error as Error).message);
  }
  if (input.partyIds.length) {
    const parties = await tx
      .select()
      .from(schema.parties)
      .where(
        and(
          eq(schema.parties.firmId, firmId),
          inArray(schema.parties.id, input.partyIds),
        ),
      );
    if (
      parties.length !== new Set(input.partyIds).size ||
      parties.some((p) => p.deletedAt)
    )
      throw invalid("Choose active trading accounts in this firm.");
  }
  if (input.commission) {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.firmId, firmId),
          eq(schema.accounts.id, input.commission.payableAccountId),
        ),
      );
    if (
      !account ||
      !["Other Current Liabilities", "Provisions"].includes(account.group) ||
      account.openingBalance !== 0
    )
      throw invalid(
        "Choose a dedicated payable account with no opening balance, under Other Current Liabilities or Provisions.",
      );
    if (input.commission.itemIds.length) {
      const items = await tx
        .select()
        .from(schema.items)
        .where(
          and(
            eq(schema.items.firmId, firmId),
            inArray(schema.items.id, input.commission.itemIds),
          ),
        );
      if (
        items.length !== new Set(input.commission.itemIds).size ||
        items.some((i) => i.deletedAt)
      )
        throw invalid("Choose active eligible items in this firm.");
    }
    if (
      !previous?.commission ||
      previous.commission.payableAccountId !== input.commission.payableAccountId
    ) {
      const [posting] = await tx
        .select({ id: schema.postings.id })
        .from(schema.postings)
        .where(
          and(
            eq(schema.postings.firmId, firmId),
            eq(schema.postings.account, acc.account(account.id)),
          ),
        )
        .limit(1);
      if (posting)
        throw invalid("Choose an unused dedicated commission payable account.");
    }
  }
  if (
    previous?.commission &&
    previous.commission.payableAccountId !== input.commission?.payableAccountId
  ) {
    const [used] = await tx
      .select({ id: t.commissionAccruals.id })
      .from(t.commissionAccruals)
      .where(
        and(
          eq(t.commissionAccruals.firmId, firmId),
          eq(t.commissionAccruals.associateId, previous.id),
        ),
      )
      .limit(1);
    const [savedSelection] = used
      ? []
      : await tx
          .select({ id: schema.vouchers.id })
          .from(schema.vouchers)
          .where(
            and(
              eq(schema.vouchers.firmId, firmId),
              sql`${schema.vouchers.commission}->>'associateId' = ${previous.id}`,
            ),
          )
          .limit(1);
    if (used || savedSelection)
      throw invalid(
        "Keep the original payable account and commission role for a profile on saved documents. Archive the profile to stop new assignments.",
      );
  }
}

async function saveRule(tx: Tx, firmId: string, associate: c.AssociateRecord) {
  if (!associate.commission) return;
  await tx.insert(t.associateRules).values({
    id: uuidv7(),
    firmId,
    associateId: associate.id,
    version: associate.version,
    snapshot: c.CommissionSnapshot.parse({
      ...associate.commission,
      associateId: associate.id,
      name: associate.name,
      ruleVersion: associate.version,
    }),
  });
}

async function entriesFor(db: Reader, firmId: string, id: string) {
  return db
    .select()
    .from(t.commissionEntries)
    .where(
      and(
        eq(t.commissionEntries.firmId, firmId),
        eq(t.commissionEntries.associateId, id),
      ),
    )
    .orderBy(asc(t.commissionEntries.date), asc(t.commissionEntries.id));
}

async function statement(
  db: Reader,
  firmId: string,
  id: string,
  query: c.AssociateStatementQuery,
) {
  const associate = await readAssociate(db, firmId, id);
  const entries = await entriesFor(db, firmId, id);
  const summary = commissionStatement(entries, query);
  const accruals = await db
    .select()
    .from(t.commissionAccruals)
    .where(
      and(
        eq(t.commissionAccruals.firmId, firmId),
        eq(t.commissionAccruals.associateId, id),
      ),
    )
    .orderBy(asc(t.commissionAccruals.date), asc(t.commissionAccruals.id));
  const balances = new Map<string, number>();
  for (const entry of entries)
    if (entry.accrualId && (!query.to || entry.date <= query.to))
      balances.set(
        entry.accrualId,
        total([balances.get(entry.accrualId) ?? 0, entry.amount]),
      );
  const accountId = associate.commission?.payableAccountId;
  const postings = accountId
    ? await db
        .select({
          debit: schema.postings.debit,
          credit: schema.postings.credit,
        })
        .from(schema.postings)
        .innerJoin(
          schema.vouchers,
          eq(schema.vouchers.id, schema.postings.voucherId),
        )
        .where(
          and(
            eq(schema.postings.firmId, firmId),
            eq(schema.vouchers.firmId, firmId),
            eq(schema.vouchers.status, "posted"),
            eq(schema.postings.account, acc.account(accountId)),
            query.to ? lte(schema.postings.date, query.to) : undefined,
            query.scope === "all"
              ? undefined
              : eq(schema.vouchers.bookScope, query.scope),
          ),
        )
    : [];
  const ledgerBalance = total(postings.map((p) => p.credit - p.debit));
  return c.AssociateStatement.parse({
    ...summary,
    ledgerBalance,
    difference: total([summary.closing, -ledgerBalance]),
    accruals: accruals
      .filter(
        (a) =>
          (query.scope === "all" || a.bookScope === query.scope) &&
          (!query.to || a.date <= query.to) &&
          (!query.from || a.date >= query.from),
      )
      .map((a) => ({ ...a, balance: balances.get(a.id) ?? 0 }))
      .filter((a) => query.unpaidOnly !== "true" || a.balance !== 0),
  });
}

async function checkDate(tx: Tx, firmId: string, date: string) {
  const [firm] = await tx
    .select()
    .from(schema.firmProfile)
    .where(eq(schema.firmProfile.firmId, firmId));
  if (!firm) throw notFound("firm");
  const error = checkVoucherDate(date, today(), firm.fyStart);
  if (error) throw invalid(error);
  await assertOpenPeriod(tx, firmId, [date]);
}

export const associatesService = {
  fields,
  options: async (db: Reader, firmId: string) =>
    (
      await db
        .select()
        .from(t.associates)
        .where(
          and(eq(t.associates.firmId, firmId), eq(t.associates.active, true)),
        )
        .orderBy(asc(t.associates.name))
    ).map((r) => ({
      id: r.id,
      name: r.name,
      roles: r.profile.roles,
      vehicle: r.profile.delivery?.vehicle ?? "",
    })),
  list(
    db: Db,
    firmId: string,
    query: {
      limit: number;
      cursor?: string;
      q?: string;
      role?: string;
      active?: string;
    },
  ) {
    return db.transaction(
      async (tx) => {
        const rows = await tx
          .select()
          .from(t.associates)
          .where(
            and(
              eq(t.associates.firmId, firmId),
              query.cursor ? gt(t.associates.id, query.cursor) : undefined,
              query.q
                ? ilike(
                    t.associates.name,
                    `%${query.q.replace(/[\\%_]/g, "\\$&")}%`,
                  )
                : undefined,
              query.role
                ? sql`${t.associates.profile}->'roles' ? ${query.role}`
                : undefined,
              query.active
                ? eq(t.associates.active, query.active === "true")
                : undefined,
            ),
          )
          .orderBy(asc(t.associates.id))
          .limit(query.limit + 1);
        return {
          items: rows.slice(0, query.limit).map(record),
          nextCursor:
            rows.length > query.limit
              ? (rows[query.limit - 1]?.id ?? null)
              : null,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  get(db: Db, firmId: string, id: string) {
    return db.transaction(
      async (tx) => {
        const associate = await readAssociate(tx, firmId, id);
        const deliveries = await tx
          .select()
          .from(t.deliveryAssignments)
          .where(
            and(
              eq(t.deliveryAssignments.firmId, firmId),
              eq(t.deliveryAssignments.associateId, id),
            ),
          )
          .orderBy(desc(t.deliveryAssignments.date));
        const payouts = await tx
          .select()
          .from(t.associatePayouts)
          .where(
            and(
              eq(t.associatePayouts.firmId, firmId),
              eq(t.associatePayouts.associateId, id),
            ),
          )
          .orderBy(desc(t.associatePayouts.date));
        return c.AssociateDetail.parse({ associate, deliveries, payouts });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  statement(
    db: Db,
    firmId: string,
    id: string,
    query: c.AssociateStatementQuery,
  ) {
    return db.transaction((tx) => statement(tx, firmId, id, query), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  },
  create(db: Db, actor: AssociateActor, raw: c.AssociateInput) {
    return associateWrite(db, actor, 201, async (tx) => {
      const input = c.AssociateInput.parse(raw);
      await validateProfile(tx, actor.firmId, input);
      const [row] = await tx
        .insert(t.associates)
        .values({
          id: uuidv7(),
          firmId: actor.firmId,
          name: input.name,
          active: input.active,
          profile: input,
          payableAccountId: input.commission?.payableAccountId,
        })
        .returning();
      const result = record(row);
      await saveRule(tx, actor.firmId, result);
      await associateAudit(
        tx,
        actor,
        result.id,
        "created",
        "Profile created",
        null,
        result,
      );
      return result;
    });
  },
  update(
    db: Db,
    actor: AssociateActor,
    id: string,
    version: number,
    raw: c.AssociateUpdate,
  ) {
    return associateWrite(db, actor, 200, async (tx) => {
      const { reason, ...input } = c.AssociateUpdate.parse(raw);
      const before = await readAssociate(tx, actor.firmId, id);
      if (before.version !== version) throw conflict();
      await validateProfile(tx, actor.firmId, input, before);
      const [row] = await tx
        .update(t.associates)
        .set({
          name: input.name,
          active: input.active,
          profile: input,
          payableAccountId: input.commission?.payableAccountId ?? null,
          version: version + 1,
        })
        .where(scoped(actor.firmId, id))
        .returning();
      const result = record(row);
      await saveRule(tx, actor.firmId, result);
      await associateAudit(tx, actor, id, "updated", reason, before, result);
      return result;
    });
  },
  saveField(
    db: Db,
    actor: AssociateActor,
    raw: c.AssociateFieldInput,
    id?: string,
    version?: number,
  ) {
    return associateWrite(db, actor, id ? 200 : 201, async (tx) => {
      const definition = c.AssociateFieldInput.parse(raw);
      const [before] = id
        ? await tx
            .select()
            .from(t.associateFields)
            .where(
              and(
                eq(t.associateFields.firmId, actor.firmId),
                eq(t.associateFields.id, id),
              ),
            )
        : [];
      if (id && !before) throw notFound("field");
      if (before && before.version !== version) throw conflict();
      if (
        before &&
        (before.definition.kind !== definition.kind ||
          JSON.stringify(before.definition.choices) !==
            JSON.stringify(definition.choices))
      )
        throw invalid(
          "Create a new field to change its type or choices; existing values retain their meaning.",
        );
      const [row] = before
        ? await tx
            .update(t.associateFields)
            .set({ definition, version: before.version + 1 })
            .where(eq(t.associateFields.id, before.id))
            .returning()
        : await tx
            .insert(t.associateFields)
            .values({ id: uuidv7(), firmId: actor.firmId, definition })
            .returning();
      if (!row) throw new Error("Associate field missing after write.");
      const result = c.AssociateField.parse({
        ...definition,
        id: row.id,
        version: row.version,
      });
      await associateAudit(
        tx,
        actor,
        null,
        "field-saved",
        definition.name,
        before ?? null,
        result,
      );
      return result;
    });
  },
  updateDelivery(
    db: Db,
    actor: AssociateActor,
    id: string,
    version: number,
    raw: c.DeliveryUpdate,
  ) {
    return associateWrite(db, actor, 200, async (tx) => {
      const input = c.DeliveryUpdate.parse(raw);
      const [before] = await tx
        .select()
        .from(t.deliveryAssignments)
        .where(
          and(
            eq(t.deliveryAssignments.firmId, actor.firmId),
            eq(t.deliveryAssignments.id, id),
          ),
        );
      if (!before) throw notFound("delivery");
      if (before.version !== version) throw conflict();
      if (!before.active)
        throw invalid("This assignment was replaced or cancelled.");
      if (input.date < before.date)
        throw invalid("Delivery status cannot precede the document date.");
      await checkDate(tx, actor.firmId, input.date);
      const [after] = await tx
        .update(t.deliveryAssignments)
        .set({
          status: input.status,
          statusDate: input.date,
          note: input.note,
          version: version + 1,
        })
        .where(eq(t.deliveryAssignments.id, id))
        .returning();
      await associateAudit(
        tx,
        actor,
        before.associateId,
        "delivery-updated",
        input.note || input.status,
        before,
        after,
      );
      return c.DeliveryAssignment.parse(after);
    });
  },
  payout(
    db: Db,
    actor: AssociateActor,
    id: string,
    version: number,
    raw: c.AssociatePayoutInput,
  ) {
    return associateWrite(db, actor, 201, async (tx) => {
      const input = c.AssociatePayoutInput.parse(raw);
      const associate = await readAssociate(tx, actor.firmId, id);
      if (associate.version !== version) throw conflict();
      await checkDate(tx, actor.firmId, input.date);
      const [bank] = await tx
        .select()
        .from(schema.ledgers)
        .where(
          and(
            eq(schema.ledgers.firmId, actor.firmId),
            eq(schema.ledgers.id, input.ledgerId),
          ),
        );
      if (!bank || bank.deletedAt)
        throw invalid("Choose an active cash or bank account in this firm.");
      const balances = await statement(tx, actor.firmId, id, {
        scope: "all",
        unpaidOnly: "false",
      });
      if (balances.difference)
        throw invalid(
          "Reconcile the commission statement to its payable ledger before recording a payout.",
        );
      const dated = await statement(tx, actor.firmId, id, {
        scope: "all",
        unpaidOnly: "false",
        to: input.date,
      });
      const chosen = input.allocations.map((a) => {
        const accrual = balances.accruals.find((r) => r.id === a.accrualId);
        const atDate = dated.accruals.find((r) => r.id === a.accrualId);
        if (
          !accrual ||
          !atDate ||
          a.amount > accrual.balance ||
          a.amount > atDate.balance
        )
          throw invalid(
            "A payout allocation exceeds the unpaid commission on its date or now.",
          );
        return { ...a, accrual };
      });
      const entries = await entriesFor(tx, actor.firmId, id);
      for (const scope of ["gst", "nongst"] as const) {
        const amount = total(
          chosen
            .filter((a) => a.accrual.bookScope === scope)
            .map((a) => a.amount),
        );
        if (
          amount >
            Math.max(0, commissionStatement(entries, { scope }).closing) ||
          amount >
            Math.max(
              0,
              commissionStatement(entries, { scope, to: input.date }).closing,
            )
        )
          throw invalid(
            "Recover returned commission before paying more in this book category.",
          );
      }
      const amount = total(chosen.map((a) => a.amount));
      if (
        amount > Math.max(0, balances.closing) ||
        amount > Math.max(0, dated.closing)
      )
        throw invalid("The payout exceeds the total commission due.");
      const [payout] = await tx
        .insert(t.associatePayouts)
        .values({
          id: uuidv7(),
          firmId: actor.firmId,
          associateId: id,
          date: input.date,
          ledgerId: input.ledgerId,
          reference: input.reference,
          amount,
        })
        .returning();
      if (!payout) throw new Error("Payout missing after write.");
      for (const scope of ["gst", "nongst"] as const) {
        const group = chosen.filter((a) => a.accrual.bookScope === scope);
        const first = group[0];
        if (!first) continue;
        const description = `Commission payout ${input.reference || payout.id}`;
        const journalId = await postAssociateJournal(tx, hookActor(actor), {
          ...first.accrual.snapshot,
          date: input.date,
          bookScope: scope,
          amount: -total(group.map((a) => a.amount)),
          bank,
          payoutId: payout.id,
          description,
        });
        for (const allocation of group) {
          await tx.insert(t.commissionPayoutAllocations).values({
            id: uuidv7(),
            firmId: actor.firmId,
            payoutId: payout.id,
            accrualId: allocation.accrualId,
            amount: allocation.amount,
          });
          await tx.insert(t.commissionEntries).values({
            id: uuidv7(),
            firmId: actor.firmId,
            associateId: id,
            accrualId: allocation.accrualId,
            payoutId: payout.id,
            journalId,
            eventKey: `payout:${payout.id}:${allocation.accrualId}`,
            date: input.date,
            bookScope: scope,
            kind: "payout",
            amount: -allocation.amount,
            description,
          });
        }
      }
      await tx
        .update(t.associates)
        .set({ version: associate.version + 1 })
        .where(scoped(actor.firmId, id));
      // Profile versions also identify rule snapshots, including after a payout.
      await saveRule(tx, actor.firmId, {
        ...associate,
        version: associate.version + 1,
      });
      await associateAudit(
        tx,
        actor,
        id,
        "payout",
        input.reference,
        null,
        payout,
      );
      return c.AssociatePayout.parse(payout);
    });
  },
  reversePayout(
    db: Db,
    actor: AssociateActor,
    payoutId: string,
    version: number,
    raw: c.AssociatePayoutReversal,
  ) {
    return associateWrite(db, actor, 200, async (tx) => {
      const input = c.AssociatePayoutReversal.parse(raw);
      const [before] = await tx
        .select()
        .from(t.associatePayouts)
        .where(
          and(
            eq(t.associatePayouts.firmId, actor.firmId),
            eq(t.associatePayouts.id, payoutId),
          ),
        );
      if (!before) throw notFound("payout");
      if (before.version !== version) throw conflict();
      if (before.reversedOn) throw invalid("This payout is already reversed.");
      if (input.date < before.date)
        throw invalid("Reversal cannot precede the payout.");
      await checkDate(tx, actor.firmId, input.date);
      const [bank] = await tx
        .select()
        .from(schema.ledgers)
        .where(
          and(
            eq(schema.ledgers.firmId, actor.firmId),
            eq(schema.ledgers.id, before.ledgerId),
          ),
        );
      if (!bank) throw notFound("bank account");
      const entries = (
        await entriesFor(tx, actor.firmId, before.associateId)
      ).filter((e) => e.payoutId === payoutId && e.kind === "payout");
      for (const scope of ["gst", "nongst"] as const) {
        const group = entries.filter((e) => e.bookScope === scope);
        const first = group[0];
        if (!first) continue;
        if (!first.accrualId) throw notFound("commission accrual");
        const [accrual] = await tx
          .select()
          .from(t.commissionAccruals)
          .where(
            and(
              eq(t.commissionAccruals.firmId, actor.firmId),
              eq(t.commissionAccruals.id, first.accrualId),
            ),
          );
        if (!accrual) throw notFound("commission accrual");
        const description = `Payout reversed: ${input.reason}`;
        const journalId = await postAssociateJournal(tx, hookActor(actor), {
          ...accrual.snapshot,
          date: input.date,
          bookScope: scope,
          amount: -total(group.map((e) => e.amount)),
          bank,
          payoutId,
          description,
        });
        for (const entry of group)
          await tx.insert(t.commissionEntries).values({
            id: uuidv7(),
            firmId: actor.firmId,
            associateId: before.associateId,
            accrualId: entry.accrualId,
            payoutId,
            journalId,
            eventKey: `payout-reversal:${entry.id}`,
            date: input.date,
            bookScope: scope,
            kind: "payout-reversal",
            amount: -entry.amount,
            description,
          });
      }
      const [after] = await tx
        .update(t.associatePayouts)
        .set({
          reversedOn: input.date,
          reversalReason: input.reason,
          version: version + 1,
        })
        .where(eq(t.associatePayouts.id, payoutId))
        .returning();
      await associateAudit(
        tx,
        actor,
        before.associateId,
        "payout-reversed",
        input.reason,
        before,
        after,
      );
      return c.AssociatePayout.parse(after);
    });
  },
};
