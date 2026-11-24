/** Recurring entries (doc 37, T03) and approvals (T06): React Query hooks. */
import type {
  ApprovalType,
  PendingEntry,
  RecurringFromVoucherInput,
  RecurringScheduleInput,
  RecurringScheduleUpdate,
} from "@repo/contracts";
import { needsApproval, type VoucherType } from "@repo/core";
import {
  useServiceQuery as useQuery,
  useServiceMutation as useMutation,
} from "./scopedHooks";
import { useData } from "./DataProvider";
import { useRefreshAll } from "./queries";

export const ENTRY_STATUS: Record<
  PendingEntry["status"],
  { label: string; tone: "neutral" | "ok" | "warn" | "bad" | "dashed" }
> = {
  draft: { label: "Draft", tone: "dashed" },
  submitted: { label: "Waiting for approval", tone: "warn" },
  rejected: { label: "Sent back", tone: "bad" },
  posted: { label: "Posted", tone: "ok" },
  discarded: { label: "Discarded", tone: "neutral" },
};

export const recurringKeys = {
  schedules: ["recurring"] as const,
  entries: ["entries"] as const,
  entry: (id: string) => ["entries", id] as const,
  approvals: ["approvals"] as const,
};

export function useSchedules() {
  return useQuery({
    queryKey: recurringKeys.schedules,
    queryFn: (services) => services.recurringService.schedules(),
  });
}

export function usePendingEntries() {
  return useQuery({
    queryKey: recurringKeys.entries,
    queryFn: (services) => services.recurringService.entries(),
  });
}

export function usePendingEntry(id: string) {
  return useQuery({
    queryKey: recurringKeys.entry(id),
    queryFn: (services) => services.recurringService.entry(id),
    enabled: !!id,
  });
}

export function useApprovalSettings() {
  return useQuery({
    queryKey: recurringKeys.approvals,
    queryFn: (services) => services.recurringService.approvals(),
  });
}

/** Does a new entry of this type from me wait for approval? */
export function useNeedsApproval(type: VoucherType) {
  const { role } = useData();
  const settings = useApprovalSettings();
  return needsApproval(type, settings.data?.types ?? [], role);
}

export function useCreateSchedule() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (services, input: RecurringScheduleInput) =>
      services.recurringService.createSchedule(input),
    onSuccess: refreshAll,
  });
}

export function useScheduleFromVoucher(voucherId: string) {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (services, input: RecurringFromVoucherInput) =>
      services.recurringService.fromVoucher(voucherId, input),
    onSuccess: refreshAll,
  });
}

export function useUpdateSchedule() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (
      services,
      args: { id: string; input: RecurringScheduleUpdate; version: number },
    ) =>
      services.recurringService.updateSchedule(
        args.id,
        args.input,
        args.version,
      ),
    onSuccess: refreshAll,
  });
}

export function useRemoveSchedule() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (services, args: { id: string; version: number }) =>
      services.recurringService.removeSchedule(args.id, args.version),
    onSuccess: refreshAll,
  });
}

type EntryAction =
  | {
      kind: "save";
      id: string;
      version: number;
      input?: Record<string, unknown>;
    }
  | {
      kind: "approve";
      id: string;
      version: number;
      input?: Record<string, unknown>;
    }
  | { kind: "reject"; id: string; version: number; reason: string }
  | { kind: "discard"; id: string; version: number }
  | {
      kind: "update";
      id: string;
      version: number;
      input: Record<string, unknown>;
    };

/** One mutation for every step on a pending entry; the result says if it posted. */
export function useEntryAction() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: async (services, action: EntryAction) => {
      const s = services.recurringService;
      switch (action.kind) {
        case "save":
          return s.saveEntry(action.id, action.version, action.input);
        case "approve":
          return s.approve(action.id, action.version, action.input);
        case "reject":
          return {
            entry: await s.reject(action.id, action.version, action.reason),
          };
        case "discard":
          return { entry: await s.discard(action.id, action.version) };
        case "update":
          return {
            entry: await s.updateEntry(action.id, action.input, action.version),
          };
      }
    },
    onSuccess: refreshAll,
  });
}

/** Send a new entry for approval instead of posting it. */
export function useSubmitEntry() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (
      services,
      args: { type: ApprovalType; input: Record<string, unknown> },
    ) => services.recurringService.submit(args.type, args.input),
    onSuccess: refreshAll,
  });
}

export function useSaveApprovals() {
  const refreshAll = useRefreshAll();
  return useMutation({
    mutationFn: (services, args: { types: ApprovalType[]; version: number }) =>
      services.recurringService.saveApprovals(args.types, args.version),
    onSuccess: refreshAll,
  });
}
