import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  can,
  isOrderType,
  orderStatus,
  stockLots,
  today,
  type Role,
} from "@repo/core";
import {
  fulfillmentStatus,
  orderLineBalances,
  orderTargets,
  planOrderFulfillment,
  type FulfillmentVoucher,
  type FulfillmentInvoiceLine,
  type OrderFulfillmentPlan,
} from "@repo/core/src/accounting/orderFulfillment";
import {
  OrderFulfillmentDetail,
  OrderFulfillmentInput,
  OrderFulfillmentResult,
} from "@repo/contracts/src/orderFulfillment";
import { schema, type Db } from "@repo/backend/db/client";
import {
  orderFulfillments,
  orderFulfillmentLines,
} from "@repo/backend/db/schema/orderFulfillment";
import { AppError } from "@repo/backend/lib/app-error";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { requireVoucherTypeRead } from "../../lib/read-permissions";
import { notFound } from "@repo/backend/modules/masters/shared";
import { loadReportBooks } from "@repo/backend/modules/reports/books";
import { enforcePlannedSaleCredit } from "../settlements/orderCredit.service";
import {
  assertOrderCapacity,
  legacyConversionBlocker,
  loadOrderGraph,
  persistSourceLines,
  sourceLineIdentity,
} from "@repo/backend/modules/order-fulfillment/orderFulfillment.repo";
import type {
  FulfillmentActor,
  FulfillmentTx,
  OrderFulfillmentHooks,
} from "./orderFulfillment.hooks";

const fail = (message: string) =>
  new AppError("INVALID_FULFILLMENT", message, 409);
function sourceLineId(line: FulfillmentInvoiceLine) {
  if (!line.orderSourceLineId)
    throw fail("The source line identity is missing.");
  return line.orderSourceLineId;
}
function core<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw fail(
      error instanceof Error ? error.message : "Cannot fulfill this order.",
    );
  }
}

async function roleInTransaction(tx: FulfillmentTx, actor: FulfillmentActor) {
  const [member] = await tx
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, actor.firmId),
        eq(schema.member.userId, actor.id),
      ),
    )
    .for("share");
  if (!member)
    throw new AppError(
      "FORBIDDEN",
      "Your membership changed. Reload the firm.",
      403,
    );
  return member.role as Role;
}

function requireWrite(role: Role, source: FulfillmentVoucher) {
  requireVoucherTypeRead(role, source.type);
  if (!can(role, source.type === "purchase-order" ? "purchase" : "sales"))
    throw new AppError(
      "FORBIDDEN",
      "Your role cannot fulfill this order.",
      403,
    );
}

/** A hook must return exactly the requested quantities with their stable source identities. */
export function validateCreatedFulfillments(
  plan: OrderFulfillmentPlan,
  saved: FulfillmentVoucher[],
) {
  if (saved.length !== plan.batches.length)
    throw fail("The creation hook did not save every book batch.");
  const expected = new Map(
    plan.batches.flatMap((b) =>
      b.lines.map((line) => [sourceLineId(line), line] as const),
    ),
  );
  const seen = new Set<string>();
  const seenBooks = new Set<string>();
  for (const voucher of saved) {
    const batch = plan.batches.find((b) => b.bookScope === voucher.bookScope);
    if (
      !batch ||
      seenBooks.has(batch.bookScope) ||
      voucher.sourceId !== plan.source.id ||
      voucher.type !== plan.target ||
      voucher.status !== "posted" ||
      voucher.partyId !== plan.source.partyId ||
      voucher.date !== plan.date ||
      voucher.taxMode !== plan.source.taxMode ||
      voucher.interState !== plan.source.interState ||
      JSON.stringify(voucher.snapshot) !==
        JSON.stringify(plan.source.snapshot) ||
      JSON.stringify(voucher.delivery) !==
        JSON.stringify(plan.source.delivery) ||
      JSON.stringify(voucher.commission) !==
        JSON.stringify(plan.source.commission) ||
      JSON.stringify(voucher.charges ?? []) !== JSON.stringify(batch.charges)
    )
      throw fail("The created entry does not match the fulfillment plan.");
    seenBooks.add(batch.bookScope);
    for (const line of voucher.lines ?? []) {
      const id = line.orderSourceLineId;
      const original = id ? expected.get(id) : undefined;
      if (
        !id ||
        !original ||
        seen.has(id) ||
        original.qty !== line.qty ||
        original.itemId !== line.itemId ||
        original.rate !== line.rate ||
        original.gstRate !== line.gstRate ||
        original.taxType !== line.taxType ||
        original.discountAmount !== line.discountAmount ||
        original.discountPercent !== line.discountPercent ||
        JSON.stringify(original.per) !== JSON.stringify(line.per) ||
        original.stockFulfilledById !== line.stockFulfilledById ||
        original.bookScope !== voucher.bookScope ||
        original.bookScope !== line.bookScope
      )
        throw fail("The creation hook changed frozen source-line details.");
      if (
        original.stockFulfilledById &&
        (original.stockLotId !== line.stockLotId ||
          original.stockCost !== line.stockCost)
      )
        throw fail("The billed delivery allocation changed.");
      if (
        (plan.target === "sale" || plan.target === "delivery-note") &&
        original.stockLotId !== line.stockLotId
      )
        throw fail("The selected stock lot changed.");
      seen.add(id);
    }
  }
  if (seen.size !== expected.size)
    throw fail("The creation hook omitted source lines.");
}

export const orderFulfillmentService = {
  async get(db: Db, firmId: string, role: Role, id: string) {
    return db.transaction(
      async (tx) => {
        const graph = await loadOrderGraph(tx, firmId);
        const source = graph.vouchers.find((v) => v.id === id);
        if (!source || !isOrderType(source.type)) throw notFound("order");
        requireVoucherTypeRead(role, source.type);
        const balances = core(() =>
          orderLineBalances(
            source,
            graph.lines,
            graph.consumptions,
            graph.vouchers,
          ),
        );
        const status = orderStatus(
          source.fulfillmentManaged
            ? { ...source, fulfillmentStatus: fulfillmentStatus(balances) }
            : source,
          today(),
        );
        const books = await loadReportBooks(tx, firmId);
        const lots = books.items
          .filter((item) => source.lines?.some((l) => l.itemId === item.id))
          .flatMap((item) => stockLots(item, books.vouchers, today()))
          .filter((lot) => lot.qty > 0);
        const blockedReason =
          legacyConversionBlocker(graph, source) ??
          (source.status !== "posted"
            ? "This order is not posted."
            : source.validUntil && source.validUntil < today()
              ? "This estimate has expired."
              : !source.snapshot
                ? "This order has no issued snapshot."
                : null);
        return OrderFulfillmentDetail.parse({
          source: {
            ...source,
            status,
            partyName: source.snapshot?.party?.name ?? "Party",
          },
          targets:
            blockedReason || status === "converted"
              ? []
              : orderTargets(source.type),
          lines: balances.map((b) => {
            const item = source.snapshot?.items.find(
              (i) => i.id === b.line.itemId,
            );
            return {
              ...b,
              itemName: item?.name ?? "Item",
              unit: b.line.per?.unit ?? item?.unit ?? "Units",
            };
          }),
          lots,
          blockedReason,
          history: graph.receipts
            .filter((r) => r.sourceId === id)
            .map((r) => ({
              id: r.id,
              date: r.response.vouchers[0].date,
              target: r.response.vouchers[0].type,
              createdAt: r.createdAt.toISOString(),
              userName: r.userName,
              vouchers: r.response.vouchers.map(
                (v) =>
                  graph.vouchers.find((current) => current.id === v.id) ?? v,
              ),
            })),
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },

  async fulfill(
    db: Db,
    actor: FulfillmentActor,
    id: string,
    body: OrderFulfillmentInput,
    hooks: OrderFulfillmentHooks,
  ) {
    const input = OrderFulfillmentInput.parse(body);
    return withFirmWrite(db, actor.firmId, async (tx) => {
      const role = await roleInTransaction(tx, actor);
      const graph = await loadOrderGraph(tx, actor.firmId);
      const source = graph.vouchers.find((v) => v.id === id);
      if (!source || !isOrderType(source.type)) throw notFound("order");
      requireWrite(role, source);
      const [replay] = await tx
        .select()
        .from(orderFulfillments)
        .where(
          and(
            eq(orderFulfillments.firmId, actor.firmId),
            eq(orderFulfillments.userId, actor.id),
            eq(orderFulfillments.key, actor.idem.key),
          ),
        );
      if (replay) {
        if (replay.requestHash !== actor.idem.hash || replay.sourceId !== id)
          throw new AppError(
            "KEY_REUSED",
            "This retry key belongs to a different request.",
            422,
          );
        return OrderFulfillmentResult.parse(replay.response);
      }
      if (source.version !== input.version)
        throw new AppError(
          "VERSION_CONFLICT",
          "This order changed. Reload its remaining quantities before saving.",
          409,
        );
      const legacy = legacyConversionBlocker(graph, source);
      if (legacy) throw fail(legacy);
      await assertOpenPeriod(tx, actor.firmId, [source.date, input.date]);
      const balances = core(() =>
        orderLineBalances(
          source,
          graph.lines,
          graph.consumptions,
          graph.vouchers,
        ),
      );
      const books = await loadReportBooks(tx, actor.firmId);
      const available = books.items.flatMap((item) =>
        stockLots(item, books.vouchers, input.date),
      );
      const plan = core(() =>
        planOrderFulfillment({
          source,
          balances,
          target: input.target,
          date: input.date,
          today: today(),
          selections: input.lines,
          narration: input.narration,
          supplierInvoiceNo: input.supplierInvoiceNo,
          availableStockLots: available,
        }),
      );
      await persistSourceLines(
        tx,
        actor.firmId,
        graph.lines.filter((l) => l.sourceId === id),
      );
      const saved = await hooks.create(tx, { ...actor, role }, plan);
      validateCreatedFulfillments(plan, saved);
      // Validate persisted ownership before retaining references returned by an adapter.
      const persisted = await tx
        .select({ id: schema.vouchers.id })
        .from(schema.vouchers)
        .where(eq(schema.vouchers.firmId, actor.firmId));
      if (saved.some((v) => !persisted.some((p) => p.id === v.id)))
        throw fail("The created entries were not saved in this firm.");
      const operationId = uuidv7();
      const result = OrderFulfillmentResult.parse({
        id: operationId,
        sourceId: id,
        version: input.version + 1,
        vouchers: saved,
      });
      await enforcePlannedSaleCredit(
        tx,
        actor,
        plan,
        result.vouchers,
        input.creditOverrideId,
      );
      await tx.insert(orderFulfillments).values({
        id: operationId,
        firmId: actor.firmId,
        sourceId: id,
        userId: actor.id,
        userName: actor.name,
        key: actor.idem.key,
        requestHash: actor.idem.hash,
        response: result,
      });
      await tx.insert(orderFulfillmentLines).values(
        saved.flatMap((v) =>
          (v.lines ?? []).map((line, targetPosition) => ({
            id: uuidv7(),
            firmId: actor.firmId,
            fulfillmentId: operationId,
            sourceLineId: sourceLineId(line),
            targetId: v.id,
            targetPosition,
            qty: line.qty,
            stockFulfilledById: line.stockFulfilledById ?? null,
          })),
        ),
      );
      for (const child of saved.filter((v) => isOrderType(v.type)))
        await persistSourceLines(
          tx,
          actor.firmId,
          (child.lines ?? []).map((line, position) => ({
            id: sourceLineIdentity(child.id, position),
            sourceId: child.id,
            position,
            line,
          })),
        );
      await tx
        .update(schema.vouchers)
        .set({
          version: sql`${schema.vouchers.version} + 1`,
          updatedAt: new Date(),
          convertedToId: null,
        })
        .where(
          and(
            eq(schema.vouchers.firmId, actor.firmId),
            eq(schema.vouchers.id, id),
          ),
        );
      await assertOrderCapacity(tx, actor.firmId);
      return result;
    });
  },
};
