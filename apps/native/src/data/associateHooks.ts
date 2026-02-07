import { useQueryClient } from "@tanstack/react-query";
import type * as c from "@repo/contracts/src/associates";
import { useData } from "./DataProvider";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import type { Services } from "./services";
import type { AssociateService } from "./associateServices";

function service(services: Services & { associateService?: AssociateService }) {
  if (!services.associateService)
    throw new Error("Associates require a connected server.");
  return services.associateService;
}
function useRefresh() {
  const client = useQueryClient();
  const { userId } = useData();
  return () => client.invalidateQueries({ queryKey: ["books", userId] });
}
export function useAssociateAccess() {
  const { role, services } = useData();
  const connected: Services & { associateService?: AssociateService } =
    services;
  return {
    write: role === "owner" || role === "accountant",
    select: role === "owner" || role === "accountant" || role === "sales",
    connected: !!connected.associateService,
  };
}
export function useAssociates() {
  const access = useAssociateAccess();
  return useServiceQuery({
    queryKey: ["associates"],
    queryFn: (s) => service(s).list(),
    enabled: access.write && access.connected,
  });
}
export function useAssociateOptions() {
  const access = useAssociateAccess();
  return useServiceQuery({
    queryKey: ["associateOptions"],
    queryFn: (s) => service(s).options(),
    enabled: access.select && access.connected,
  });
}
export function useAssociateFields() {
  const access = useAssociateAccess();
  return useServiceQuery({
    queryKey: ["associateFields"],
    queryFn: (s) => service(s).fields(),
    enabled: access.write && access.connected,
  });
}
export function useAssociate(id: string) {
  const access = useAssociateAccess();
  return useServiceQuery({
    queryKey: ["associate", id],
    queryFn: (s) => service(s).get(id),
    enabled: !!id && access.write && access.connected,
  });
}
export function useAssociateStatement(
  id: string,
  query: c.AssociateStatementQuery,
) {
  const access = useAssociateAccess();
  return useServiceQuery({
    queryKey: ["associateStatement", id, query],
    queryFn: (s) => service(s).statement(id, query),
    enabled: !!id && access.write && access.connected,
  });
}
export function useSaveAssociate(id?: string) {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (
      s,
      input: { data: c.AssociateInput; version?: number; reason?: string },
    ) =>
      id
        ? service(s).update(
            id,
            { ...input.data, reason: input.reason ?? "" },
            input.version!,
          )
        : service(s).create(input.data),
    onSuccess: refresh,
  });
}
export function useSaveAssociateField() {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (
      s,
      input: { data: c.AssociateFieldInput; id?: string; version?: number },
    ) => service(s).saveField(input.data, input.id, input.version),
    onSuccess: refresh,
  });
}
export function useAssociateDelivery() {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (
      s,
      input: { id: string; data: c.DeliveryUpdate; version: number },
    ) => service(s).delivery(input.id, input.data, input.version),
    onSuccess: refresh,
  });
}
export function useAssociatePayout(id: string) {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (s, input: { data: c.AssociatePayoutInput; version: number }) =>
      service(s).payout(id, input.data, input.version),
    onSuccess: refresh,
  });
}
export function useReverseAssociatePayout() {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (
      s,
      input: { id: string; data: c.AssociatePayoutReversal; version: number },
    ) => service(s).reverse(input.id, input.data, input.version),
    onSuccess: refresh,
  });
}
