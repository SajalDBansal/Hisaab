import { useQueryClient } from "@tanstack/react-query";
import type { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import { useData } from "./DataProvider";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import type { Services } from "./services";

function service(s: Services) {
  if (!s.inventoryService)
    throw new Error("Stock corrections require a connected firm.");
  return s.inventoryService;
}
export function useInventoryAccess() {
  const { role, services } = useData();
  return {
    connected: !!services.inventoryService,
    write: role === "owner" || role === "accountant",
    read: role !== "sales",
  };
}
export function useInventoryAdjustments() {
  const access = useInventoryAccess();
  return useServiceQuery({
    queryKey: ["inventoryAdjustments"],
    queryFn: (s) => service(s).list(),
    enabled: access.read && access.connected,
  });
}
export function useInventoryWrite() {
  const client = useQueryClient();
  const { userId } = useData();
  return useServiceMutation({
    mutationFn: (s, input: InventoryAdjustmentInput) =>
      service(s).create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["books", userId] }),
  });
}
export function useInventoryReverse() {
  const client = useQueryClient();
  const { userId } = useData();
  return useServiceMutation({
    mutationFn: (s, input: { id: string; date: string; reason: string }) =>
      service(s).reverse(input.id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["books", userId] }),
  });
}
