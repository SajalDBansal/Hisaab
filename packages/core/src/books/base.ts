/** Book state, defaults, numbering, party lookup and the audit log shared by every entry. */
import type { CustomAccount } from "../accounting/accounts";
import type { OpeningAccount } from "../accounting/generalLedger";
import { financialYear } from "../dates";
import type {
  AuditAction,
  AuditChange,
  AuditEntry,
  Firm,
  ID,
  InvoiceSettings,
  ISODate,
  Item,
  Ledger,
  Party,
  ReminderSettings,
  StoredDocument,
  TeamMember,
  UnitDef,
  Voucher,
  VoucherType,
} from "../types";

export interface Db {
  accounts?: CustomAccount[];
  firm: Firm;
  parties: Party[];
  items: Item[];
  ledgers: Ledger[];
  vouchers: Voucher[];
  /** Opening balances of other accounts, e.g. furniture. Capital balances them. */
  openingAccounts: OpeningAccount[];
  /** Last used number per voucher type and financial year, e.g. { "sale:26-27": 149 }. */
  counters: Record<string, number>;
  invoiceSettings: InvoiceSettings;
  team: TeamMember[];
  /** The person using the app (an owner in the demo). */
  currentUserId: ID;
  documents: StoredDocument[];
  /** Units of measure the firm can use on items. */
  units: UnitDef[];
  /** WhatsApp payment reminder rules. */
  reminders: ReminderSettings;
  /** Last date a reminder was sent to each customer (partyId → date). */
  remindedOn: Record<ID, ISODate>;
  /** Notifications the user has already seen. */
  readNotices: string[];
  /** When the books were last backed up (ISO date-time). */
  lastBackupAt?: string;
  /** Edit history of every voucher: only ever added to (see accounting/audit.ts). */
  auditLog: AuditEntry[];
}

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  daysBefore: 3,
  onDueDate: true,
  repeatEvery: 7,
  minAmount: 50000, // ₹500
};

/** Default voucher number prefixes; the owner can change them in Settings. */
export const DEFAULT_BILL_OF_SUPPLY_PREFIX = "BS";

export const DEFAULT_PREFIXES: Record<VoucherType, string> = {
  sale: "SI",
  purchase: "PI",
  receipt: "RC",
  payment: "PY",
  expense: "EX",
  journal: "JV",
  "credit-note": "CN",
  "debit-note": "DN",
  contra: "CT",
  estimate: "EST",
  "sales-order": "SO",
  "delivery-note": "DC",
  "purchase-order": "PO",
};

let idCounter = 0;
export function newId(prefix: string): ID {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Number the next voucher would get, e.g. "SI/26-27/0150". Does not reserve it. */
/** Number series: normal, or "bos" for sales bills of supply (their own series, e.g. BS/26-27/0001). */
export type Series = "bos" | "nongst";

const counterKey = (type: VoucherType, date: ISODate, series?: Series) =>
  `${type}${series ? `-${series}` : ""}:${financialYear(date).short}`;

export function peekNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const fy = financialYear(date).short;
  const next = (db.counters[counterKey(type, date, series)] ?? 0) + 1;
  const prefix =
    series === "nongst"
      ? `N${db.invoiceSettings.prefixes[type]}`
      : series === "bos"
        ? db.invoiceSettings.billOfSupplyPrefix
        : db.invoiceSettings.prefixes[type];
  return `${prefix}/${fy}/${String(next).padStart(4, "0")}`;
}

export function takeNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const number = peekNumber(db, type, date, series);
  const key = counterKey(type, date, series);
  db.counters[key] = (db.counters[key] ?? 0) + 1;
  return number;
}

export function findParty(db: Db, id: ID): Party {
  const party = db.parties.find((p) => p.id === id);
  if (!party) throw new Error(`Party not found: ${id}`);
  return party;
}

export interface CreateOptions {
  /** Only the historical demo importer uses this; API inputs cannot enable it. */
  legacyStock?: boolean;
  pendingSync?: boolean;
  status?: Voucher["status"];
}

// ---------------------------------------------------------------------------
// Edit history (audit trail)
// ---------------------------------------------------------------------------

/** Add one line to the edit log. There is no way to remove or switch it off. */
export function logAudit(
  db: Db,
  action: AuditAction,
  v: Voucher,
  changes: AuditChange[] = [],
  note?: string,
): void {
  const user = db.team.find((m) => m.id === db.currentUserId);
  db.auditLog.push({
    id: newId("log"),
    voucherId: v.id,
    number: v.number,
    voucherType: v.type,
    action,
    // "created" uses the voucher's own save time (seed data is dated in the past)
    at: action === "created" ? v.createdAt : new Date().toISOString(),
    userId: db.currentUserId,
    userName: user?.name ?? "Unknown",
    changes,
    note,
  });
}

export const auditNames = (db: Db) => ({
  party: (id?: string) => db.parties.find((p) => p.id === id)?.name ?? "",
  item: (id: string) => db.items.find((i) => i.id === id)?.name ?? "Item",
});
