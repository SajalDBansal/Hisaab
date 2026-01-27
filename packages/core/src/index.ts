// Public entry of @repo/core. Apps import everything from "@repo/core".
export * from "./types";
export * from "./money";
export * from "./dates";
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
export { settingsService, type InvoiceSettingsView } from "./services/settingsService";
export { unitService, type UnitRow } from "./services/unitService";
export { type FirmRow } from "./services/firmService";
export * from "./text";
export type { Db as MockDb } from "./mock/db";
export { cleanItem, cleanParty } from "./mock/db";
// The write rules (numbering, GST, settling bills), run by the API on a snapshot of the firm's books
export { updateInvoiceSettings } from "./mock/db";
export * from "./precision";
