import * as demo from "@repo/core";
import { demoCashForecastService } from "./cashForecastService";
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
  YearEndView,
  YearEndClose,
} from "@repo/contracts";

export const demoServices = {
  cashForecastService: demoCashForecastService,
  bookControlService: {
    get: signInForBookControls,
    update: signInForBookControls,
    history: signInForBookControls,
    allocations: signInForBookControls,
    allocate: signInForBookControls,
    yearEnd: signInForBookControls,
    closeYear: signInForBookControls,
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
  printService: demo.printService,
  searchService: demo.searchService,
  notificationService: demo.notificationService,
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
