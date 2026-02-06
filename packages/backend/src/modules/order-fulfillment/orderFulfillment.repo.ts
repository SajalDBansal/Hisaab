import { and, eq, inArray, or, sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import { isOrderType, type Voucher } from "@repo/core";
import {
  fulfillmentStatus,
  assertOrderQuantityHistory,
  orderLineBalances,
  type FulfillmentVoucher,
  type OrderConsumption,
  type OrderSourceLine,
  type OrderQuantityVoucher,
} from "@repo/core/src/accounting/orderFulfillment";
import { schema, type Db } from "../../db/client";
import {
  orderSourceLines,
  orderFulfillmentLines,
  orderFulfillments,
} from "../../db/schema/orderFulfillment";
import { AppError } from "../../lib/app-error";
import { hydrateVouchers } from "../vouchers/snapshot";
type FulfillmentTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

type Reader = Pick<Db, "select">;
export interface OrderGraph {
  vouchers: FulfillmentVoucher[];
  lines: OrderSourceLine[];
  consumptions: (OrderConsumption & {
    fulfillmentId: string;
    stockFulfilledById: string | null;
  })[];
  receipts: (typeof orderFulfillments.$inferSelect)[];
}

export const sourceLineIdentity = (sourceId: string, position: number) =>
  uuidv5(`order-line:${position}`, sourceId);

function sourceLines(vouchers: Voucher[], saved: OrderSourceLine[]) {
  const byPosition = new Map(
    saved.map((row) => [`${row.sourceId}:${row.position}`, row]),
  );
  for (const voucher of vouchers.filter((v) => isOrderType(v.type)))
    for (const [position, line] of (voucher.lines ?? []).entries()) {
      const key = `${voucher.id}:${position}`;
      if (!byPosition.has(key))
        byPosition.set(key, {
          id: sourceLineIdentity(voucher.id, position),
          sourceId: voucher.id,
          position,
          line,
        });
    }
  return [...byPosition.values()];
}

/** Complete quantity graph even when the caller hydrates one order or one list page. */
async function quantityVouchers(
  db: Reader,
  firmId: string,
  targetIds: string[],
): Promise<OrderQuantityVoucher[]> {
  if (!targetIds.length) return [];
  const rows = await db
    .select({
      id: schema.vouchers.id,
      type: schema.vouchers.type,
      status: schema.vouchers.status,
      againstId: schema.vouchers.againstId,
    })
    .from(schema.vouchers)
    .where(
      and(
        eq(schema.vouchers.firmId, firmId),
        or(
          inArray(schema.vouchers.id, targetIds),
          inArray(schema.vouchers.againstId, targetIds),
        ),
      ),
    );
  const ids = rows.map((v) => v.id);
  const lines = ids.length
    ? await db
        .select({
          voucherId: schema.voucherLines.voucherId,
          qty: schema.voucherLines.qty,
          sourceLine: schema.voucherLines.sourceLine,
          position: schema.voucherLines.position,
          discountAmount: schema.voucherLines.discountAmount,
        })
        .from(schema.voucherLines)
        .where(
          and(
            eq(schema.voucherLines.firmId, firmId),
            inArray(schema.voucherLines.voucherId, ids),
          ),
        )
    : [];
  return rows.map((row) => ({
    ...row,
    againstId: row.againstId ?? undefined,
    lines: lines
      .filter((line) => line.voucherId === row.id)
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        qty: line.qty ?? 0,
        sourceLine: line.sourceLine ?? undefined,
        discountAmount: line.discountAmount || undefined,
      })),
  }));
}

async function metadata(db: Reader, firmId: string) {
  const lines = await db
    .select()
    .from(orderSourceLines)
    .where(eq(orderSourceLines.firmId, firmId));
  const consumptions = await db
    .select()
    .from(orderFulfillmentLines)
    .where(eq(orderFulfillmentLines.firmId, firmId));
  const receipts = await db
    .select()
    .from(orderFulfillments)
    .where(eq(orderFulfillments.firmId, firmId));
  return { lines, consumptions, receipts };
}

/** Call after the ordinary hydration; metadata lives outside replaceable voucher line rows. */
export async function hydrateOrderFulfillment(
  db: Reader,
  firmId: string,
  vouchers: Voucher[],
): Promise<FulfillmentVoucher[]> {
  const meta = await metadata(db, firmId);
  const managed = new Set([
    ...meta.receipts.map((r) => r.sourceId),
    ...meta.consumptions.map((c) => c.targetId),
  ]);
  const lines = sourceLines(vouchers, meta.lines);
  const quantities = await quantityVouchers(db, firmId, [
    ...new Set(meta.consumptions.map((c) => c.targetId)),
  ]);
  return vouchers.map((v) => {
    if (!managed.has(v.id)) return v;
    const result: FulfillmentVoucher = { ...v, fulfillmentManaged: true };
    result.lines = v.lines?.map((line, position) => {
      const incoming = meta.consumptions.find(
        (c) => c.targetId === v.id && c.targetPosition === position,
      );
      const own = lines.find(
        (l) => l.sourceId === v.id && l.position === position,
      );
      return {
        ...line,
        ...(own ? { orderLineId: own.id } : {}),
        ...(incoming
          ? {
              orderSourceLineId: incoming.sourceLineId,
              stockFulfilledById: incoming.stockFulfilledById ?? undefined,
            }
          : {}),
      };
    });
    if (isOrderType(v.type)) {
      result.fulfillmentStatus = fulfillmentStatus(
        orderLineBalances(v, lines, meta.consumptions, quantities),
      );
    }
    return result;
  });
}

export async function loadOrderGraph(
  db: Reader,
  firmId: string,
): Promise<OrderGraph> {
  const rows = await db
    .select()
    .from(schema.vouchers)
    .where(eq(schema.vouchers.firmId, firmId));
  const versions = new Map(rows.map((row) => [row.id, row.version]));
  const vouchers = (await hydrateVouchers(db, rows)).map((v) => ({
    ...v,
    version: versions.get(v.id),
  }));
  const meta = await metadata(db, firmId);
  const managed = new Set([
    ...meta.receipts.map((r) => r.sourceId),
    ...meta.consumptions.map((c) => c.targetId),
  ]);
  return {
    ...meta,
    vouchers: vouchers.map((v) => ({
      ...v,
      fulfillmentManaged: managed.has(v.id),
    })),
    lines: sourceLines(vouchers, meta.lines),
  };
}

export async function persistSourceLines(
  tx: FulfillmentTx,
  firmId: string,
  lines: OrderSourceLine[],
) {
  if (lines.length)
    await tx
      .insert(orderSourceLines)
      .values(lines.map((row) => ({ ...row, firmId })))
      .onConflictDoNothing();
}

export function legacyConversionBlocker(
  graph: OrderGraph,
  source: FulfillmentVoucher,
) {
  return (source.convertedToId && !source.fulfillmentManaged) ||
    graph.vouchers.some(
      (v) =>
        v.sourceId === source.id &&
        v.status === "posted" &&
        !graph.consumptions.some((c) => c.targetId === v.id),
    )
    ? "This order has a legacy conversion without source-line quantities. Review its linked entry first."
    : null;
}

/** Called by normal voucher edit/cancel paths while holding the firm's write lock. */
export async function assertOrderChangeAllowed(
  tx: FulfillmentTx,
  firmId: string,
  id: string,
  action: "edit" | "cancel",
) {
  const graph = await loadOrderGraph(tx, firmId);
  const owned = new Set(
    graph.lines.filter((line) => line.sourceId === id).map((line) => line.id),
  );
  const outgoing = graph.consumptions.filter((c) => owned.has(c.sourceLineId));
  if (
    action === "edit" &&
    (outgoing.length || graph.consumptions.some((c) => c.targetId === id))
  )
    throw new AppError(
      "ORDER_LINE_FROZEN",
      "This entry has fulfillment history. Cancel the linked entries and issue a replacement instead of editing it.",
      409,
    );
  if (
    action === "cancel" &&
    outgoing.some((c) =>
      graph.vouchers.some((v) => v.id === c.targetId && v.status === "posted"),
    )
  )
    throw new AppError(
      "ORDER_HAS_CHILDREN",
      "Cancel the order's active fulfillment entries first.",
      409,
    );
}

export async function assertOrderCapacity(tx: FulfillmentTx, firmId: string) {
  try {
    const graph = await loadOrderGraph(tx, firmId);
    assertOrderQuantityHistory(graph.vouchers, graph.lines, graph.consumptions);
  } catch (error) {
    throw new AppError(
      "ORDER_QUANTITY_CONFLICT",
      error instanceof Error ? error.message : "Order quantities changed.",
      409,
    );
  }
}

/** After a return or cancellation, refresh affected order versions in the same transaction. */
export async function afterOrderVoucherChange(
  tx: FulfillmentTx,
  firmId: string,
  changedId: string,
) {
  await assertOrderCapacity(tx, firmId);
  const graph = await loadOrderGraph(tx, firmId);
  const changed = graph.vouchers.find((v) => v.id === changedId);
  const targets = new Set([
    changedId,
    ...(changed?.againstId ? [changed.againstId] : []),
  ]);
  const affected = new Set<string>();
  // A delivery return also affects its originating sales order, but not an estimate's order acceptance.
  for (let depth = 0; depth < 2; depth++) {
    for (const use of graph.consumptions.filter((c) =>
      targets.has(c.targetId),
    )) {
      const source = graph.lines.find((l) => l.id === use.sourceLineId);
      if (!source) continue;
      affected.add(source.sourceId);
      if (
        graph.vouchers.find((v) => v.id === source.sourceId)?.type ===
        "delivery-note"
      )
        targets.add(source.sourceId);
    }
  }
  // These are operational quantity/version changes. The financial path checks
  // the actual return/cancellation date; an old source date does not lock them.
  for (const id of affected)
    await tx
      .update(schema.vouchers)
      .set({
        version: sql`${schema.vouchers.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.vouchers.firmId, firmId), eq(schema.vouchers.id, id)),
      );
}
