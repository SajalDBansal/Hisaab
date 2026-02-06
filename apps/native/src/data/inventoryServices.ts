import { Voucher } from "@repo/contracts";
import {
  InventoryAdjustmentInput,
  InventoryReversalInput,
} from "@repo/contracts/src/inventory";
import type { Client } from "./client";

export function inventoryServices(client: Client) {
  return {
    list: () => client.pages("/inventory/adjustments", Voucher),
    create: (input: InventoryAdjustmentInput) => {
      InventoryAdjustmentInput.parse(input);
      return client.request("/inventory/adjustments", Voucher, { body: input });
    },
    reverse: (id: string, input: { date: string; reason: string }) =>
      client.request(`/inventory/adjustments/${id}/reverse`, Voucher, {
        body: InventoryReversalInput.parse(input),
      }),
  };
}
export type InventoryService = ReturnType<typeof inventoryServices>;
