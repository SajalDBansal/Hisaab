import * as demo from "@repo/core";
import { demoCashForecastService } from "./cashForecastService";
import {
  demoEntryNotices,
  demoRecurringService,
  type RecurringService,
} from "./recurringServices";
import type { ImportService } from "./importServices";
import type { LoanService } from "./loanServices";
import type { InventoryService } from "./inventoryServices";
import type { AssociateService } from "./associateServices";
import type { SettlementService } from "./settlementServices";
import type { OrderFulfillmentService } from "./orderFulfillmentServices";
import type {
  BackupRecoveryStatus,
  BackupRestoreInput,
  BackupRestorePreview,
  BackupRestorePreviewInput,
  BackupRestoreResult,
  BookControlChange,
  BookControlHistoryPage,
  BookControlView,
  OpeningAllocationView,
  OpeningAllocationChange,
  RoleInput,
  RolesView,
  YearEndView,
  YearEndClose,
} from "@repo/contracts";

export const demoServices = {
  cashForecastService: demoCashForecastService,
  // Recurring entries and approvals (doc 37, T03/T06), on the in-memory books.
  recurringService: demoRecurringService as RecurringService,
  bookControlService: {
    get: signInForBookControls,
    update: signInForBookControls,
    history: signInForBookControls,
    allocations: signInForBookControls,
    allocate: signInForBookControls,
    yearEnd: signInForBookControls,
    closeYear: signInForBookControls,
  },
  // Custom roles need the server (doc 37, T57); the demo lists the built-ins.
  roleService: {
    list: async (): Promise<RolesView> => ({
      builtIn: demo.BUILT_IN_ROLES.map((role) => ({
        role,
        label: demo.roleInfo(role).label,
        note: demo.roleInfo(role).note,
        rights: demo.presetRights(role),
      })),
      custom: [],
    }),
    save: (async () => unavailable()) as (
      input: RoleInput,
      id?: string,
      version?: number,
    ) => Promise<RolesView>,
    remove: (async () => unavailable()) as (id: string) => Promise<RolesView>,
  },
  firmService: demo.firmService,
  partyService: demo.partyService,
  itemService: demo.itemService,
  ledgerService: demo.ledgerService,
  voucherService: demo.voucherService,
  accountService: demo.accountService,
  reportService: demo.reportService,
  gstService: demo.gstService,
  settingsService: demo.settingsService,
  unitService: demo.unitService,
  customFieldService: demo.customFieldService,
  printService: demo.printService,
  searchService: demo.searchService,
  notificationService: {
    ...demo.notificationService,
    // Recurring drafts and approvals join the bell, as on the server.
    async list(): Promise<demo.NoticeList> {
      const [list, pending] = await Promise.all([
        demo.notificationService.list(),
        demoEntryNotices(),
      ]);
      const read = new Set(list.notices.filter((n) => n.read).map((n) => n.id));
      const extra = pending.map((n) => ({ ...n, read: read.has(n.id) }));
      return {
        notices: [...extra, ...list.notices],
        unread: list.unread + extra.filter((n) => !n.read).length,
      };
    },
  },
  documentService: demo.documentService,
  reminderService: demo.reminderService,
  bankService: demo.bankService,
  backupService: {
    ...demo.backupService,
    previewRestore: unavailable,
    restoreNewFirm: unavailable,
    recovery: unavailable,
  },
  auditService: demo.auditService,
};
export type Services = Omit<
  typeof demoServices,
  | "partyService"
  | "itemService"
  | "voucherService"
  | "bookControlService"
  | "backupService"
> & {
  importService?: ImportService;
  loanService?: LoanService;
  inventoryService?: InventoryService;
  associateService?: AssociateService;
  settlementService?: SettlementService;
  orderFulfillmentService?: OrderFulfillmentService;
  backupService: typeof demo.backupService & {
    previewRestore(
      input: BackupRestorePreviewInput,
    ): Promise<BackupRestorePreview>;
    restoreNewFirm(input: BackupRestoreInput): Promise<BackupRestoreResult>;
    recovery(): Promise<BackupRecoveryStatus>;
  };
  bookControlService: {
    get(): Promise<BookControlView>;
    history(cursor?: string): Promise<BookControlHistoryPage>;
    update(input: BookControlChange): Promise<BookControlView>;
    allocations(): Promise<OpeningAllocationView>;
    allocate(input: OpeningAllocationChange): Promise<OpeningAllocationView>;
    yearEnd(year: number): Promise<YearEndView>;
    closeYear(input: YearEndClose): Promise<YearEndView>;
  };
  partyService: Omit<typeof demo.partyService, "update"> & {
    update(
      id: string,
      input: demo.PartyInput,
      version?: number,
    ): Promise<demo.Party>;
  };
  itemService: Omit<typeof demo.itemService, "update"> & {
    update(
      id: string,
      input: demo.ItemInput,
      version?: number,
    ): Promise<demo.Item>;
  };
  voucherService: Omit<
    typeof demo.voucherService,
    "updateInvoice" | "cancel"
  > & {
    updateInvoice(
      id: string,
      input: demo.NewInvoiceInput,
      version?: number,
    ): Promise<demo.Voucher>;
    cancel(id: string, reason: string, version?: number): Promise<demo.Voucher>;
  };
};

export async function unavailable(): Promise<never> {
  throw new Error("This action isn't connected to the server yet.");
}

async function signInForBookControls(): Promise<never> {
  throw new Error(
    "Sign in to review opening balances and manage period locks for a saved firm.",
  );
}
