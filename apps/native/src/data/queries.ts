/**
 * React Query hooks — the ONLY way screens get or change data.
 *
 * Screens keep the same service shapes. The provider selects real API services
 * for signed-in users; only explicit demo mode uses the in-memory books.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useServiceQuery as useQuery, useServiceMutation as useMutation } from "./scopedHooks";
import { type Ledger, type DocumentKind, type PeriodKey, type TaxScope, type PartyType, type VoucherFilters, type VoucherType } from "@repo/core";
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
