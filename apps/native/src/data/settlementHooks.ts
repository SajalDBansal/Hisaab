import { useQueryClient } from "@tanstack/react-query";
import type {
  SettlementInput,
  SettlementContextQuery,
  LoanInterestInput,
  CreditApprovalInput,
  OrderCreditApprovalInput,
} from "@repo/contracts/src/settlements";
import type { Services } from "./services";
import { useData } from "./DataProvider";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import type { SettlementService } from "./settlementServices";

function service(s: Services & { settlementService?: SettlementService }) {
  if (!s.settlementService)
    throw new Error("Settlements require a connected server.");
  return s.settlementService;
}
export function useSettlementAccess() {
  const { role, services } = useData();
  const available: Services & { settlementService?: SettlementService } =
    services;
  return {
    read: role === "owner" || role === "accountant" || role === "viewer",
    write: role === "owner" || role === "accountant",
    owner: role === "owner",
    connected: !!available.settlementService,
  };
}
function useRefresh() {
  const query = useQueryClient();
  const { userId } = useData();
  return () => query.invalidateQueries({ queryKey: ["books", userId] });
}
export function useSettlements() {
  const access = useSettlementAccess();
  return useServiceQuery({
    queryKey: ["settlements"],
    queryFn: (s) => service(s).list(),
    enabled: access.read && access.connected,
  });
}
export function useSettlement(id: string) {
  const access = useSettlementAccess();
  return useServiceQuery({
    queryKey: ["settlement", id],
    queryFn: (s) => service(s).get(id),
    enabled: !!id && access.read && access.connected,
  });
}
export function useSettlementContext(input: SettlementContextQuery) {
  const access = useSettlementAccess();
  return useServiceQuery({
    queryKey: ["settlementContext", input],
    queryFn: (s) => service(s).context(input),
    enabled: !!input.partyId && access.write && access.connected,
  });
}
export function useCreateSettlement() {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (s, input: SettlementInput) => service(s).create(input),
    onSuccess: refresh,
  });
}
export function useReverseSettlement(id: string) {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (s, input: Parameters<SettlementService["reverse"]>[1]) =>
      service(s).reverse(id, input),
    onSuccess: refresh,
  });
}
export function usePostLoanInterest() {
  const refresh = useRefresh();
  return useServiceMutation({
    mutationFn: (s, input: LoanInterestInput) => service(s).interest(input),
    onSuccess: refresh,
  });
}
export function useApproveSaleCredit() {
  return useServiceMutation({
    mutationFn: (s, input: CreditApprovalInput) =>
      service(s).approveCredit(input),
  });
}
export function useApproveOrderCredit() {
  return useServiceMutation({
    mutationFn: (s, input: OrderCreditApprovalInput) =>
      service(s).approveOrderCredit(input),
  });
}
