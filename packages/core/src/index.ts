// Public entry of @repo/core. Apps import everything from "@repo/core".

export * from "./types";
export * from "./money";
export * from "./dates";
export * from "./reporting";
export * from "./accounting";
export * from "./accounting/stockLots";
export * from "./accounting/tradeRates";
export * from "./accounting/bookScope";
export * from "./validation";
export * from "./permissions";
export * from "./states";
export * from "./units";

// Data services — the only way apps should read or write data.
export { API_BASE_URL, resetDb } from "./services/client";
export { firmService, type FirmWithYear } from "./services/firmService";
export {
  partyService,
  type PartyListRow,
  type PartyDetail,
} from "./services/partyService";
export {
  itemService,
  type ItemListRow,
  type ItemDetail,
  type ItemParties,
} from "./services/itemService";
export {
  ledgerService,
  type LedgerWithBalance,
} from "./services/ledgerService";
export {
  voucherService,
  type InvoiceRow,
  allowedDates,
  type OrderRow,
  type ReturnableBill,
  type VoucherDetail,
  type VoucherFilters,
} from "./services/voucherService";
export { reportService } from "./services/reportService";
export { accountService } from "./services/accountService";
export { gstService } from "./services/gstService";
export {
  settingsService,
  type InvoiceSettingsView,
  type TeamPresence,
} from "./services/settingsService";
export { documentService, type DocumentRow } from "./services/documentService";
export { unitService, type UnitRow } from "./services/unitService";
export * from "./print/voucherHtml";
export * from "./print/messages";
export { printService, type PrintableVoucher } from "./services/printService";
export { type FirmRow } from "./services/firmService";
export {
  searchService,
  type SearchHit,
  type SearchResults,
} from "./services/searchService";
export {
  notificationService,
  reminderService,
  type NoticeRow,
  type NoticeList,
} from "./services/notificationService";
export { bankService, type ReconciliationView } from "./services/bankService";
export {
  backupService,
  readBackup,
  type BackupStatus,
  type BackupSummary,
} from "./services/backupService";
export { auditService } from "./services/auditService";
export * from "./text";

// For the API: the demo books, used to fill a local database (db/seed.ts)
export { buildSeed, secondDemoFirm, blankBooks } from "./mock/seed";
export type { Db as MockDb } from "./mock/db";
export { cleanItem, cleanParty } from "./mock/db";
// The write rules (numbering, GST, settling bills), run by the API on a snapshot of the firm's books
export {
  cancelBlocker,
  cancelVoucher,
  createContra,
  createExpense,
  createJournal,
  createInventoryJournal,
  allocatePartyPayments,
  createNote,
  createOrder,
  createPayment,
  createPurchase,
  createReceipt,
  createSale,
  createSales,
  editBlocker,
  setCleared,
  updateInvoice,
  updateInvoiceSettings,
} from "./mock/db";
export * from "./precision";
export * from "./accounting/voucherSnapshot";
export { checkInvoiceNumbers } from "./accounting/invoiceValidation";
