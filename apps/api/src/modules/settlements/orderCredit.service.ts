import { and, eq } from "drizzle-orm";
import { partyBalance, stockLots, today } from "@repo/core";
import {
  createPlannedFulfillments,
  orderLineBalances,
  planOrderFulfillment,
  type OrderFulfillmentPlan,
} from "@repo/core/src/accounting/orderFulfillment";
import type { Voucher } from "@repo/contracts";
import type { OrderCreditApprovalInput } from "@repo/contracts/src/settlements";
import { schema, type Db } from "@repo/backend/db/client";
import { assertOpenPeriod } from "@repo/backend/lib/book-period";
import { loadBooks } from "@repo/backend/modules/vouchers/snapshot";
import {
  legacyConversionBlocker,
  loadOrderGraph,
} from "@repo/backend/modules/order-fulfillment/orderFulfillment.repo";
import {
  creditRequestHash,
  enforceCreditForPostedSales,
  saveCreditApproval,
} from "./credit.service";
import {
  invalid,
  required,
  settlementWrite,
  type SettlementActor,
  type SettlementTx,
} from "@repo/backend/modules/settlements/settlements.shared";

export const orderCreditHash = (plan: OrderFulfillmentPlan) =>
  creditRequestHash({ kind: "order-fulfillment", plan });

export async function approveOrderCredit(
  db: Db,
  actor: SettlementActor,
  input: OrderCreditApprovalInput,
) {
  return settlementWrite(
    db,
    actor,
    async (tx) => {
      if (input.fulfillment.target !== "sale")
        invalid("Only a sale needs customer credit approval.");
      const graph = await loadOrderGraph(tx, actor.firmId);
      const source = required(
        graph.vouchers.find((v) => v.id === input.sourceId),
        "Order not found.",
      );
      if (source.version !== input.fulfillment.version)
        invalid(
          "The order changed. Reload the remaining quantities.",
          "VERSION_CONFLICT",
          409,
        );
      const blocker = legacyConversionBlocker(graph, source);
      if (blocker) invalid(blocker);
      const [party] = await tx
        .select()
        .from(schema.parties)
        .where(
          and(
            eq(schema.parties.firmId, actor.firmId),
            eq(schema.parties.id, source.partyId ?? ""),
          ),
        );
      if (!party || party.deletedAt || party.type !== "customer")
        invalid("Select an active customer order.");
      await assertOpenPeriod(tx, actor.firmId, [
        source.date,
        input.fulfillment.date,
      ]);
      const snapshot = await loadBooks(
        tx,
        actor.firmId,
        { id: actor.userId, name: actor.userName },
        {
          parties: [party.id],
          vouchers: [source.id],
          items: source.lines?.map((l) => l.itemId),
        },
      );
      if ((source.lines ?? []).some((l) => snapshot.deleted.has(l.itemId)))
        invalid("An order item is archived.");
      let plan: OrderFulfillmentPlan;
      try {
        plan = planOrderFulfillment({
          source,
          balances: orderLineBalances(
            source,
            graph.lines,
            graph.consumptions,
            graph.vouchers,
          ),
          target: input.fulfillment.target,
          date: input.fulfillment.date,
          today: today(),
          selections: input.fulfillment.lines,
          narration: input.fulfillment.narration,
          supplierInvoiceNo: input.fulfillment.supplierInvoiceNo,
          availableStockLots: snapshot.books.items.flatMap((item) =>
            stockLots(item, snapshot.books.vouchers, input.fulfillment.date),
          ),
        });
        createPlannedFulfillments(snapshot.books, plan);
      } catch (error) {
        invalid(
          error instanceof Error ? error.message : "Invalid order fulfillment.",
        );
      }
      const projected = partyBalance(
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
        projected,
        orderCreditHash(plan),
        input.reason,
      );
    },
    true,
  );
}

/** Call after saving all batches, before committing the same firm-locked fulfillment transaction. */
export async function enforcePlannedSaleCredit(
  tx: SettlementTx,
  actor: { firmId: string; id: string },
  plan: OrderFulfillmentPlan,
  saved: Voucher[],
  creditOverrideId?: string,
) {
  if (plan.target !== "sale") return;
  return enforceCreditForPostedSales(
    tx,
    actor,
    {
      partyId: required(plan.source.partyId, "Customer not found."),
      saleHash: orderCreditHash(plan),
      creditOverrideId,
    },
    saved,
  );
}
