import {
  OrderFulfillmentDetail,
  OrderFulfillmentInput,
  OrderFulfillmentResult,
} from "@repo/contracts/src/orderFulfillment";
import type { Client } from "./client";

export function orderFulfillmentServices(client: Client) {
  return {
    get: (id: string) =>
      client.request(`/orders/${id}/fulfillment`, OrderFulfillmentDetail),
    fulfill: (id: string, input: OrderFulfillmentInput) =>
      client.request(`/orders/${id}/fulfill`, OrderFulfillmentResult, {
        body: OrderFulfillmentInput.parse(input),
      }),
  };
}
export type OrderFulfillmentService = ReturnType<
  typeof orderFulfillmentServices
>;
