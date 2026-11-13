import type {
  LoanInput,
  LoanUpdate,
  LoanReferenceInput,
} from "@repo/contracts/src/loans";
import { useData } from "./DataProvider";
import {
  useServiceMutation,
  useServicePages,
  useServiceQuery,
} from "./scopedHooks";
import { useQueryClient } from "@tanstack/react-query";
import type { Services } from "./services";
import type { LoanService } from "./loanServices";

function useRefreshAll() {
  const client = useQueryClient();
  const { userId } = useData();
  return () => client.invalidateQueries({ queryKey: ["books", userId] });
}

function service(services: Services & { loanService?: LoanService }) {
  if (!services.loanService)
    throw new Error("Loan register requires a connected server.");
  return services.loanService;
}

export function useLoanAccess() {
  const { role, services } = useData();
  const connected: Services & { loanService?: LoanService } = services;
  return {
    read: role === "owner" || role === "accountant" || role === "viewer",
    write: role === "owner" || role === "accountant",
    connected: !!connected.loanService,
  };
}
/** The register screen, a page at a time as the user scrolls. */
export function useLoanPages() {
  const access = useLoanAccess();
  return useServicePages({
    queryKey: ["loanPages"],
    queryFn: (s, cursor) => service(s).listPage(cursor),
    enabled: access.read && access.connected,
  });
}
export function useLoans() {
  const access = useLoanAccess();
  return useServiceQuery({
    queryKey: ["loans"],
    queryFn: (s) => service(s).list(),
    enabled: access.read && access.connected,
  });
}
export function useLoan(id: string) {
  const access = useLoanAccess();
  return useServiceQuery({
    queryKey: ["loan", id],
    queryFn: (s) => service(s).get(id),
    enabled: !!id && access.read && access.connected,
  });
}
export function useLoanHistory(id: string) {
  const access = useLoanAccess();
  return useServiceQuery({
    queryKey: ["loanHistory", id],
    queryFn: (s) => service(s).history(id),
    enabled: !!id && access.read && access.connected,
  });
}
export function useLoanCandidates(id: string) {
  const access = useLoanAccess();
  return useServiceQuery({
    queryKey: ["loanCandidates", id],
    queryFn: (s) => service(s).candidates(id),
    enabled: !!id && access.write && access.connected,
  });
}
export function useCreateLoan() {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (s, input: LoanInput) => service(s).create(input),
    onSuccess: refresh,
  });
}
export function useUpdateLoan(id: string) {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (s, input: { data: LoanUpdate; version: number }) =>
      service(s).update(id, input.data, input.version),
    onSuccess: refresh,
  });
}
export function useAddLoanReference(id: string) {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (s, input: { data: LoanReferenceInput; version: number }) =>
      service(s).addReference(id, input.data, input.version),
    onSuccess: refresh,
  });
}
export function useRemoveLoanReference(id: string) {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (
      s,
      input: { referenceId: string; reason: string; version: number },
    ) =>
      service(s).removeReference(
        id,
        input.referenceId,
        input.reason,
        input.version,
      ),
    onSuccess: refresh,
  });
}
