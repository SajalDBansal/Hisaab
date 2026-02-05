import type { OpeningAllocationChange, YearEndClose } from "@repo/contracts";
import { useServiceMutation, useServiceQuery } from "./scopedHooks";
import { useRefreshAll } from "./queries";

export const useOpeningAllocations = () =>
  useServiceQuery({
    queryKey: ["openingAllocations"],
    queryFn: (s) => s.bookControlService.allocations(),
  });
export function useAllocateOpenings() {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (s, input: OpeningAllocationChange) =>
      s.bookControlService.allocate(input),
    onSuccess: refresh,
  });
}
export const useYearEnd = (year: number) =>
  useServiceQuery({
    queryKey: ["yearEnd", year],
    queryFn: (s) => s.bookControlService.yearEnd(year),
  });
export function useCloseYear() {
  const refresh = useRefreshAll();
  return useServiceMutation({
    mutationFn: (s, input: YearEndClose) =>
      s.bookControlService.closeYear(input),
    onSuccess: refresh,
  });
}
