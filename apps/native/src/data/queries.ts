/**
 * React Query hooks — the ONLY way screens get or change data.
 *
 * Screens keep the same service shapes. The provider selects real API services
 * for signed-in users; only explicit demo mode uses the in-memory books.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useServiceQuery as useQuery, useServiceMutation as useMutation } from "./scopedHooks";
import { type Ledger, type NewFirmInput, type ReminderSettings, type DocumentKind, type FirmUpdate, type PeriodKey, type TaxScope, type TeamMember, type PartyType, type VoucherFilters, type VoucherType } from "@repo/core";
import { useData } from "./DataProvider";
import { useReportScope } from "./reportScope";
/** Cache keys in one place so invalidation is easy to follow. */
export const keys = {
    firm: ["firm"] as const,
    dashboard: ["dashboard"] as const,
    parties: (type?: PartyType) => ["parties", type ?? "all"] as const,
    party: (id: string) => ["party", id] as const,
    items: ["items"] as const,
    item: (id: string) => ["item", id] as const,
    ledgers: ["ledgers"] as const,
    vouchers: (filters: VoucherFilters) => ["vouchers", filters] as const,
    voucher: (id: string) => ["voucher", id] as const,
    nextNumber: (type: VoucherType, series?: "bos" | "nongst", fy?: string) => ["nextNumber", type, series ?? "normal", fy ?? "now"] as const,
    invoices: (type: "sale" | "purchase") => ["invoices", type] as const,
    statement: (ledgerId: string) => ["statement", ledgerId] as const,
    chart: ["chart"] as const,
    trialBalance: ["trialBalance"] as const,
    finalAccounts: ["finalAccounts"] as const,
    accountStatement: (key: string) => ["accountStatement", key] as const,
    pickableAccounts: ["pickableAccounts"] as const,
    gstMonths: ["gstMonths"] as const,
    gstr1: (month: string) => ["gstr1", month] as const,
    gstr3b: (month: string) => ["gstr3b", month] as const,
    outstanding: (type: PartyType) => ["outstanding", type] as const,
    tradeSummary: (kind: "sale" | "purchase", period: PeriodKey, scope: TaxScope) => ["tradeSummary", kind, period, scope] as const,
    expenses: (period: PeriodKey) => ["expenses", period] as const,
    stock: (scope: TaxScope) => ["stockSummary", scope] as const,
    invoiceSettings: ["invoiceSettings"] as const,
    team: ["team"] as const,
    documents: (kind?: DocumentKind) => ["documents", kind ?? "all"] as const,
    units: ["units"] as const,
    firms: ["firms"] as const,
    search: (q: string) => ["search", q] as const,
    notices: ["notices"] as const,
    reminders: ["reminders"] as const,
    remindersDue: ["remindersDue"] as const,
    reconciliation: (ledgerId: string) => ["reconciliation", ledgerId] as const,
    backup: ["backup"] as const,
};
export function useCreateLedger() {
    const refresh = useRefreshAll();
    return useMutation({
        mutationFn: (s, input: Omit<Ledger, "id">) => s.ledgerService.create(input),
        onSuccess: refresh,
    });
}
export function useAllocatePayments() {
    const refresh = useRefreshAll();
    return useMutation({
        mutationFn: (s, id: string) => s.partyService.allocatePayments(id),
        onSuccess: refresh,
    });
}
export const usePrepareReminder = () => useMutation({
    mutationFn: (s, id: string) => s.printService.reminder(id),
});
export const useFirm = () => useQuery({
    queryKey: keys.firm,
    queryFn: (services) => services.firmService.getCurrent(),
});
export const useDashboard = () => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.dashboard, tax],
        queryFn: (s) => s.reportService.dashboard(tax),
    });
};
export const useLedgers = () => useQuery({
    queryKey: keys.ledgers,
    queryFn: (services) => services.ledgerService.listCashAndBank(),
});
export const useInvoiceSettings = () => useQuery({
    queryKey: keys.invoiceSettings,
    queryFn: (services) => services.settingsService.invoice(),
});
export const useTeam = () => useQuery({
    queryKey: keys.team,
    queryFn: (services) => services.settingsService.team(),
});
export const useUnits = () => useQuery({
    queryKey: keys.units,
    queryFn: (services) => services.unitService.list(),
});
/** WhatsApp reminder text for a party. */
export const useReminder = (partyId: string) => useQuery({
    queryKey: ["reminder", partyId],
    queryFn: (services) => services.printService.reminder(partyId),
    enabled: !!partyId,
});
// ---- Writes -----------------------------------------------------------------
/**
 * A new voucher changes balances, stock, reports and lists, so after saving
 * we simply refresh everything. Simple and always correct.
 */
export function useRefreshAll() {
    const client = useQueryClient();
    const { userId } = useData();
    return () => client.invalidateQueries({ queryKey: ["books", userId] });
}
export function useUpdateFirm() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, patch: FirmUpdate) => services.settingsService.updateFirm(patch),
        onSuccess: refreshAll,
    });
}
export function useUpdateMember() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, args: {
            id: string;
            patch: Partial<Pick<TeamMember, "role" | "active">>;
        }) => services.settingsService.updateMember(args.id, args.patch),
        onSuccess: refreshAll,
    });
}
export function useInviteMember() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: {
            email: string;
            role: Exclude<TeamMember["role"], "owner">;
        }) => services.settingsService.invite(input),
        onSuccess: refreshAll,
    });
}
export function useAddUnit() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: {
            name: string;
            uqc: string;
        }) => services.unitService.add(input),
        onSuccess: refreshAll,
    });
}
export function useSetUnitEnabled() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, args: {
            name: string;
            enabled: boolean;
        }) => services.unitService.setEnabled(args.name, args.enabled),
        onSuccess: refreshAll,
    });
}
export function useRemoveUnit() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, name: string) => services.unitService.remove(name),
        onSuccess: refreshAll,
    });
}
// ---- Search, notifications, firms, reminders, banking and backup -----------
export const useSearch = (query: string) => useQuery({
    queryKey: keys.search(query.trim()),
    queryFn: (services) => services.searchService.search(query.trim()),
    enabled: query.trim().length >= 2,
});
export const useNotices = () => useQuery({
    queryKey: keys.notices,
    queryFn: (services) => services.notificationService.list(),
});
export function useMarkNoticesRead() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, ids: string[]) => services.notificationService.markRead(ids),
        onSuccess: refreshAll,
    });
}
export const useFirms = () => useQuery({
    queryKey: keys.firms,
    queryFn: (services) => services.firmService.list(),
});
/** Opening another firm changes every screen's data, so everything refreshes. */
export function useSwitchFirm() {
    const refreshAll = useRefreshAll();
    return useMutation({
        changesFirm: true,
        mutationFn: (services, id: string) => services.firmService.switchTo(id),
        onSuccess: refreshAll,
    });
}
export function useCreateFirm() {
    const refreshAll = useRefreshAll();
    return useMutation({
        changesFirm: true,
        mutationFn: (services, input: NewFirmInput) => services.firmService.create(input),
        onSuccess: refreshAll,
    });
}
export const useReminderSettings = () => useQuery({
    queryKey: keys.reminders,
    queryFn: (services) => services.reminderService.settings(),
});
export const useRemindersDue = () => useQuery({
    queryKey: keys.remindersDue,
    queryFn: (services) => services.reminderService.due(),
});
export function useUpdateReminders() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, patch: Partial<ReminderSettings>) => services.reminderService.update(patch),
        onSuccess: refreshAll,
    });
}
export function useMarkReminderSent() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, partyId: string) => services.reminderService.markSent(partyId),
        onSuccess: refreshAll,
    });
}
/** The firm's edit log (audit trail), newest first. */
export const useAuditLog = () => useQuery({
    queryKey: ["auditLog"],
    queryFn: (services) => services.auditService.list(),
});
