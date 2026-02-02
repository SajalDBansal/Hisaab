import { financialYear, today, type DocumentFile } from "@repo/core";
import { FirmDetail } from "@repo/contracts";
import {
  BackupExportResponse,
  BackupInspection,
  BackupStatusView,
  BackupRestorePreview,
  BackupRestoreResult,
  BackupRecoveryStatus,
  RESTORE_UNAVAILABLE,
} from "@repo/contracts";
import { createClient, type Transport } from "./client";
import { masterServices } from "./masterServices";
import { readServices } from "./readServices";
import { voucherServices } from "./voucherServices";
import { type Services, unavailable } from "./services";
import { documentServices } from "./documentServices";
import { loanServices } from "./loanServices";
import { inventoryServices } from "./inventoryServices";
import { associateServices } from "./associateServices";
import { settlementServices } from "./settlementServices";
import { orderFulfillmentServices } from "./orderFulfillmentServices";
import { importServices } from "./importServices";
import { cashForecastService } from "./cashForecastService";

/** Real mode has no fallback to demo books, even for screens not connected yet. */
export function remoteServices(
  transport: Transport,
  firmId: string | null,
  uploadFile: (url: string, file: DocumentFile) => Promise<void> = unavailable,
): Services {
  const client = createClient(transport, firmId);
  return {
    loanService: loanServices(client),
    inventoryService: inventoryServices(client),
    associateService: associateServices(client),
    settlementService: settlementServices(client),
    orderFulfillmentService: orderFulfillmentServices(client),
    importService: importServices(client),
    cashForecastService: cashForecastService(client),
    ...masterServices(client),
    ...readServices(client),
    voucherService: voucherServices(client),
    firmService: {
      getCurrent: async () => ({
        ...(await client.request("/firms/current", FirmDetail)),
        fyLabel: financialYear(today()).label,
      }),
      list: unavailable,
      create: unavailable,
      switchTo: unavailable,
    },
    documentService: documentServices(client, uploadFile),
    backupService: {
      status: () => client.request("/backup/status", BackupStatusView),
      create: () => client.request("/backup/export", BackupExportResponse),
      inspect: (text) =>
        client.request("/backup/inspect", BackupInspection, { body: { text } }),
      restore: async () => {
        throw new Error(RESTORE_UNAVAILABLE);
      },
      previewRestore: (input) =>
        client.request("/backup/restore-preview", BackupRestorePreview, {
          body: input,
        }),
      restoreNewFirm: (input) =>
        client.request("/backup/restore", BackupRestoreResult, { body: input }),
      recovery: () => client.request("/backup/recovery", BackupRecoveryStatus),
    },
  };
}
