// Public entry of @repo/core. Apps import everything from "@repo/core".
export * from "./types";
export * from "./money";
export * from "./dates";
export * from "./accounting";
export * from "./accounting/stockLots";
export * from "./accounting/bookScope";
export * from "./validation";
export * from "./permissions";
export * from "./states";
export * from "./units";
// Data services — the only way apps should read or write data.
export { API_BASE_URL, resetDb } from "./services/client";
export { firmService, type FirmWithYear } from "./services/firmService";
export { partyService, type PartyListRow, type PartyDetail } from "./services/partyService";
export { itemService, type ItemListRow, type ItemDetail } from "./services/itemService";
export { ledgerService, type LedgerWithBalance } from "./services/ledgerService";
export { voucherService, type InvoiceRow, allowedDates, type OrderRow, type ReturnableBill, type VoucherDetail, type VoucherFilters } from "./services/voucherService";
export { accountService } from "./services/accountService";
export { settingsService, type InvoiceSettingsView } from "./services/settingsService";
export { unitService, type UnitRow } from "./services/unitService";
export { type FirmRow } from "./services/firmService";
export * from "./text";
// For the API: the demo books, used to fill a local database (db/seed.ts)
export { buildSeed, secondDemoFirm, blankBooks } from "./mock/seed";
export type { Db as MockDb } from "./mock/db";
export { cleanItem, cleanParty } from "./mock/db";
// The write rules (numbering, GST, settling bills), run by the API on a snapshot of the firm's books
export { cancelBlocker, cancelVoucher, createContra, createExpense, createJournal, allocatePartyPayments, createNote, createPayment, createPurchase, createReceipt, createSale, createSales, editBlocker, updateInvoice, updateInvoiceSettings } from "./mock/db";
export * from "./precision";
export * from "./accounting/voucherSnapshot";
export { checkInvoiceNumbers } from "./accounting/invoiceValidation";
