/** Hooks for the catalogue settings (doc 37, Phase 2): salespersons. */
import type { SalespersonInput } from "@repo/core";
import {
  useServiceQuery as useQuery,
  useServiceMutation as useMutation,
} from "./scopedHooks";
import { useRefreshAll } from "./queries";

export function useSalespersons() {
  return useQuery({
    queryKey: ["salespersons"],
    queryFn: (services) => services.catalogService.salespersons(),
  });
}

export function useSaveSalesperson() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (
      services,
      args: { input: SalespersonInput; id?: string; version?: number },
    ) =>
      services.catalogService.saveSalesperson(
        args.input,
        args.id,
        args.version,
      ),
    onSuccess: refreshAll,
  });
}
