/**
 * React Query hooks — the ONLY way screens get or change data.
 *
 * Screens keep the same service shapes. The provider selects real API services
 * for signed-in users; only explicit demo mode uses the in-memory books.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { BookControlChange } from "@repo/contracts";
import { useServiceQuery as useQuery, useServiceMutation as useMutation } from "./scopedHooks";
import { financialYear, type AccountInput, type Ledger, type NewFirmInput, type ReminderSettings, type NewExpenseInput, type DocumentKind, type DocumentFilters, type DocumentFile, type FirmUpdate, type InvoiceSettings, type InvoiceTemplate, type ItemInput, type PartyInput, type NewDocumentInput, type NewInvoiceInput, type PeriodKey, type ReportRequest, type TaxScope, type TeamMember, type NewJournalInput, type NewNoteInput, type NewContraInput, type NewOrderInput, type OrderType, type NewMoneyInput, type PartyType, type VoucherFilters, type VoucherType } from "@repo/core";
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
// ---- Reads ------------------------------------------------------------------
export const useAccountMasters = () => useQuery({
    queryKey: ["accountMasters"],
    queryFn: (s) => s.accountService.list(),
});
export function useCreateAccount() {
    const refresh = useRefreshAll();
    return useMutation({
        mutationFn: (s, input: AccountInput) => s.accountService.create(input),
        onSuccess: refresh,
    });
}
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
export const useBookControlHistory = (cursor?: string) => useQuery({
    queryKey: ["bookControlHistory", cursor ?? "first"],
    queryFn: (s) => s.bookControlService.history(cursor),
});
export const useDashboard = () => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.dashboard, tax],
        queryFn: (s) => s.reportService.dashboard(tax),
    });
};
export const useParties = (type?: PartyType) => useQuery({
    queryKey: keys.parties(type),
    queryFn: (services) => services.partyService.list(type),
});
export const useParty = (id: string) => useQuery({
    queryKey: keys.party(id),
    queryFn: (services) => services.partyService.get(id),
    enabled: !!id,
});
export const useItems = () => useQuery({
    queryKey: keys.items,
    queryFn: (services) => services.itemService.list(),
});
export const useItem = (id: string) => useQuery({
    queryKey: keys.item(id),
    queryFn: (services) => services.itemService.get(id),
    enabled: !!id,
});
export const useLedgers = () => useQuery({
    queryKey: keys.ledgers,
    queryFn: (services) => services.ledgerService.listCashAndBank(),
});
export const useVouchers = (filters: VoucherFilters = {}) => useQuery({
    queryKey: keys.vouchers(filters),
    queryFn: (services) => services.voucherService.list(filters),
});
export const useVoucher = (id: string) => useQuery({
    queryKey: keys.voucher(id),
    queryFn: (services) => services.voucherService.get(id),
    enabled: !!id,
});
/** Next voucher number; series "bos" = sales bill of supply. `date` picks the financial year. */
export const useNextNumber = (type: VoucherType, series?: "bos" | "nongst", date?: string) => {
    const fy = date ? financialYear(date).short : undefined;
    return useQuery({
        queryKey: keys.nextNumber(type, series, fy),
        queryFn: (services) => services.voucherService.nextNumber(type, series, date),
    });
};
export const useInvoices = (type: "sale" | "purchase") => useQuery({
    queryKey: keys.invoices(type),
    queryFn: (services) => services.voucherService.listInvoices(type),
});
export const useLedgerStatement = (ledgerId: string) => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.statement(ledgerId), tax],
        queryFn: (services) => services.ledgerService.statement(ledgerId, tax),
        enabled: !!ledgerId,
    });
};
// ---- Accounting and GST ----------------------------------------------------
export const useChart = () => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.chart, tax],
        queryFn: (s) => s.accountService.chart(tax),
    });
};
export const useTrialBalance = () => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.trialBalance, tax],
        queryFn: (s) => s.accountService.trialBalance(tax),
    });
};
export const useFinalAccounts = (from?: string, to?: string) => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.finalAccounts, tax, from, to],
        queryFn: (s) => s.accountService.finalAccounts(tax, from, to),
    });
};
export const useAccountStatement = (key: string) => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.accountStatement(key), tax],
        queryFn: (services) => services.accountService.statement(key, tax),
        enabled: !!key,
    });
};
export const usePickableAccounts = () => useQuery({
    queryKey: keys.pickableAccounts,
    queryFn: (services) => services.accountService.pickable(),
});
/** Composition firms: CMP-08 figures, this quarter first. */
export const useCompositionQuarters = () => useQuery({
    queryKey: ["compositionQuarters"],
    queryFn: (services) => services.gstService.compositionQuarters(),
});
export const useGstMonths = () => useQuery({
    queryKey: keys.gstMonths,
    queryFn: (services) => services.gstService.months(),
});
export const useGstr1 = (month: string) => useQuery({
    queryKey: keys.gstr1(month),
    queryFn: (services) => services.gstService.gstr1(month),
    enabled: !!month,
});
export const useGstr3b = (month: string) => useQuery({
    queryKey: keys.gstr3b(month),
    queryFn: (services) => services.gstService.gstr3b(month),
    enabled: !!month,
});
// ---- Reports, settings and documents -----------------------------------------
export const useExportReport = () => useMutation({
    mutationFn: (s, input: ReportRequest) => s.reportService.exportReport(input),
});
export const useOutstanding = (type: PartyType) => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.outstanding(type), tax],
        queryFn: (services) => services.reportService.outstanding(type, tax),
    });
};
export const useTradeSummary = (kind: "sale" | "purchase", period: PeriodKey, scope: TaxScope = "all") => useQuery({
    queryKey: keys.tradeSummary(kind, period, scope),
    queryFn: (services) => services.reportService.tradeSummary(kind, period, scope),
});
export const useExpenseSummary = (period: PeriodKey) => {
    const [tax] = useReportScope();
    return useQuery({
        queryKey: [...keys.expenses(period), tax],
        queryFn: (services) => services.reportService.expenses(period, tax),
    });
};
export const useStockSummary = (scope: TaxScope = "all") => useQuery({
    queryKey: keys.stock(scope),
    queryFn: (services) => services.reportService.stock(scope),
});
export const useInvoiceSettings = () => useQuery({
    queryKey: keys.invoiceSettings,
    queryFn: (services) => services.settingsService.invoice(),
});
export const useTeam = () => useQuery({
    queryKey: keys.team,
    queryFn: (services) => services.settingsService.team(),
});
export const useBookControls = () => useQuery({
    queryKey: ["book-controls"],
    queryFn: (services) => services.bookControlService.get(),
});
export function useUpdateBookControls() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: BookControlChange) => services.bookControlService.update(input),
        onSuccess: refreshAll,
    });
}
export const useDocuments = (filters: DocumentFilters = {}) => useQuery({
    queryKey: ["documents", filters],
    queryFn: (services) => services.documentService.list(filters),
});
export const useDocumentFolders = () => useQuery({
    queryKey: ["document-folders"],
    queryFn: (services) => services.documentService.folders(),
});
export const useDocumentDownload = () => useMutation({
    mutationFn: (services, id: string) => services.documentService.download(id),
});
export function useUpdateDocument() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: {
            id: string;
            folder: string;
            note?: string;
        }) => services.documentService.update(input.id, input),
        onSuccess: refreshAll,
    });
}
export const useDocumentThumbnail = (id: string, enabled: boolean) => useQuery({
    queryKey: ["document-thumbnail", id],
    queryFn: (services) => services.documentService.thumbnail(id),
    enabled,
    staleTime: 5 * 60 * 1000,
});
export const useUnits = () => useQuery({
    queryKey: keys.units,
    queryFn: (services) => services.unitService.list(),
});
/** Printable HTML for a voucher; `template` previews another format. */
export const usePrintable = (id: string, template?: InvoiceTemplate) => useQuery({
    queryKey: ["printable", id, template ?? "saved"],
    queryFn: (services) => services.printService.voucher(id, template),
    enabled: !!id,
});
/** WhatsApp reminder text for a party. */
export const useReminder = (partyId: string) => useQuery({
    queryKey: ["reminder", partyId],
    queryFn: (services) => services.printService.reminder(partyId),
    enabled: !!partyId,
});
/** Estimates / sales orders / challans / purchase orders, newest first. */
export const useOrders = (type: OrderType) => useQuery({
    queryKey: ["orders", type],
    queryFn: (services) => services.voucherService.listOrders(type),
});
/** A bill's lines with what is left to return. */
export const useReturnable = (billId: string) => useQuery({
    queryKey: ["returnable", billId],
    queryFn: (services) => services.voucherService.returnable(billId),
    enabled: !!billId,
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
export function useCreateSale() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewInvoiceInput) => services.voucherService.createSale(input),
        onSuccess: refreshAll,
    });
}
export function useCreateSales() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewInvoiceInput) => services.voucherService.createSales(input),
        onSuccess: refreshAll,
    });
}
export const useStockLots = (date?: string) => useQuery({
    queryKey: ["stockLots", date],
    queryFn: (services) => services.itemService.lots(date),
});
export function useCreatePurchase() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewInvoiceInput) => services.voucherService.createPurchase(input),
        onSuccess: refreshAll,
    });
}
export function useCreateReceipt() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewMoneyInput) => services.voucherService.createReceipt(input),
        onSuccess: refreshAll,
    });
}
export function useCreatePayment() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewMoneyInput) => services.voucherService.createPayment(input),
        onSuccess: refreshAll,
    });
}
export function useCreateExpense() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewExpenseInput) => services.voucherService.createExpense(input),
        onSuccess: refreshAll,
    });
}
export function useCreateJournal() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewJournalInput) => services.voucherService.createJournal(input),
        onSuccess: refreshAll,
    });
}
export function useUpdateFirm() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, patch: FirmUpdate) => services.settingsService.updateFirm(patch),
        onSuccess: refreshAll,
    });
}
export function useUpdateInvoiceSettings() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, patch: Partial<InvoiceSettings>) => services.settingsService.updateInvoice(patch),
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
export function useAddDocument() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewDocumentInput & {
            file: DocumentFile;
        }) => services.documentService.add(input),
        onSuccess: refreshAll,
    });
}
export function useRemoveDocument() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, id: string) => services.documentService.remove(id),
        onSuccess: refreshAll,
    });
}
export function useSaveParty(id?: string, version?: number) {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: PartyInput) => id
            ? services.partyService.update(id, input, version)
            : services.partyService.create(input),
        onSuccess: refreshAll,
    });
}
export function useSaveItem(id?: string, version?: number) {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: ItemInput) => id
            ? services.itemService.update(id, input, version)
            : services.itemService.create(input),
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
export function useCancelVoucher() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, args: {
            id: string;
            reason: string;
            version?: number;
        }) => services.voucherService.cancel(args.id, args.reason, args.version),
        onSuccess: refreshAll,
    });
}
export function useUpdateInvoice(id: string, version?: number) {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewInvoiceInput) => services.voucherService.updateInvoice(id, input, version),
        onSuccess: refreshAll,
    });
}
export function useCreateNote(kind: "credit" | "debit") {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewNoteInput) => kind === "credit"
            ? services.voucherService.createCreditNote(input)
            : services.voucherService.createDebitNote(input),
        onSuccess: refreshAll,
    });
}
export function useCreateContra() {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewContraInput) => services.voucherService.createContra(input),
        onSuccess: refreshAll,
    });
}
export function useCreateOrder(type: OrderType) {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, input: NewOrderInput) => services.voucherService.createOrder(type, input),
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
export const useReconciliation = (ledgerId: string) => useQuery({
    queryKey: keys.reconciliation(ledgerId),
    queryFn: (services) => services.bankService.reconciliation(ledgerId),
    enabled: !!ledgerId,
});
export function useSetCleared(ledgerId: string) {
    const refreshAll = useRefreshAll();
    return useMutation({
        mutationFn: (services, { id, date }: {
            id: string;
            date: string | null;
        }) => services.bankService.setCleared(id, date, ledgerId),
        onSuccess: refreshAll,
    });
}
/** The firm's edit log (audit trail), newest first. */
export const useAuditLog = () => useQuery({
    queryKey: ["auditLog"],
    queryFn: (services) => services.auditService.list(),
});
