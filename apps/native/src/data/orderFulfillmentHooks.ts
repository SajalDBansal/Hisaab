import type { OrderFulfillmentInput } from "@repo/contracts/src/orderFulfillment";
import { useQueryClient } from "@tanstack/react-query";
import { useData } from "./DataProvider";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import type { Services } from "./services";
import type { OrderFulfillmentService } from "./orderFulfillmentServices";

type Connected = Services & {
  orderFulfillmentService?: OrderFulfillmentService;
};
function service(services: Connected) {
  if (!services.orderFulfillmentService)
    throw new Error("Order fulfillment requires a connected server.");
  return services.orderFulfillmentService;
}
export function useOrderFulfillmentAccess() {
  const { role, services } = useData();
  return {
    connected: !!(services as Connected).orderFulfillmentService,
    sales: role === "owner" || role === "accountant" || role === "sales",
    purchase: role === "owner" || role === "accountant",
  };
}
export function useOrderFulfillment(id: string) {
  const access = useOrderFulfillmentAccess();
  return useServiceQuery({
    queryKey: ["orderFulfillment", id],
    queryFn: (services) => service(services).get(id),
    enabled: !!id && access.connected,
    staleTime: 0,
  });
}
export function useFulfillOrder(id: string) {
  const client = useQueryClient();
  const { userId } = useData();
  return useServiceMutation({
    mutationFn: (services, input: OrderFulfillmentInput) =>
      service(services).fulfill(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["books", userId] }),
  });
}
