/** Hooks for the catalogue settings (doc 37, Phase 2): salespersons, price lists. */
import type {
  PriceListInput,
  SalespersonInput,
  VariantAttribute,
} from "@repo/core";
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

/** Sale and purchase price lists (doc 37, T36); purchase lists only for roles that see costs. */
export function usePriceLists() {
  return useQuery({
    queryKey: ["price-lists"],
    queryFn: (services) => services.catalogService.priceLists(),
  });
}

export function useSavePriceList() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (
      services,
      args: { input: PriceListInput; id?: string; version?: number },
    ) =>
      services.catalogService.savePriceList(args.input, args.id, args.version),
    onSuccess: refreshAll,
  });
}

/** Make variant items of a parent (doc 37, T35). */
export function useMakeVariants() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (
      services,
      args: {
        parentId: string;
        attributes: VariantAttribute[];
        version?: number;
      },
    ) =>
      services.catalogService.makeVariants(
        args.parentId,
        args.attributes,
        args.version,
      ),
    onSuccess: refreshAll,
  });
}
