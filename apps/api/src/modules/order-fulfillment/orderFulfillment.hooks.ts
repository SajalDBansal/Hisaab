import type { Role } from "@repo/core";
import type {
  FulfillmentVoucher,
  OrderFulfillmentPlan,
} from "@repo/core/src/accounting/orderFulfillment";
import type { Db } from "@repo/backend/db/client";
import type { Idem } from "@repo/backend/modules/vouchers/idempotency";
import { createPlannedFulfillments } from "@repo/core/src/accounting/orderFulfillment";
import { change } from "../vouchers/vouchers.service";
import { AppError } from "@repo/backend/lib/app-error";
import { prepareInvoiceAssociates } from "../associates/associates.hooks";

export type FulfillmentTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface FulfillmentActor {
  firmId: string;
  id: string;
  name: string;
  role: Role;
  idem: Idem;
}
export interface OrderFulfillmentHooks {
  /** Use this transaction and existing financial engine; preserve all frozen plan fields. */
  create(
    tx: FulfillmentTx,
    actor: FulfillmentActor,
    plan: OrderFulfillmentPlan,
  ): Promise<FulfillmentVoucher[]>;
}

/** Registered by the parent with the routes; change() retains its existing save/number/audit path. */
export const orderFulfillmentHooks: OrderFulfillmentHooks = {
  async create(tx, actor, plan) {
    const partyId = plan.source.partyId;
    if (!partyId)
      throw new AppError(
        "INVALID_FULFILLMENT",
        "The source party is missing.",
        409,
      );
    return change(
      tx,
      { ...actor, idem: undefined },
      {
        vouchers: [plan.source.id],
        parties: [partyId],
        items: [
          ...new Set(plan.batches.flatMap((b) => b.lines.map((l) => l.itemId))),
        ],
      },
      async (snap, writeTx) => {
        if (
          [
            partyId,
            ...plan.batches.flatMap((b) => b.lines.map((l) => l.itemId)),
          ].some((id) => snap.deleted.has(id))
        )
          throw new AppError(
            "INVALID_FULFILLMENT",
            "A party or item on this order is archived.",
            409,
          );
        await prepareInvoiceAssociates(writeTx, actor, {}, plan.date, plan.source);
        try {
          return createPlannedFulfillments(snap.books, plan);
        } catch (error) {
          throw new AppError(
            "INVALID_FULFILLMENT",
            error instanceof Error
              ? error.message
              : "Cannot fulfill this order.",
            409,
          );
        }
      },
    );
  },
};
