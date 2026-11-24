/** Book state, defaults, numbering, party lookup and the audit log shared by every entry. */
import type { CustomAccount } from "../accounting/accounts";
import type { OpeningAccount } from "../accounting/generalLedger";
import type { CustomFieldDef } from "../customFields";
import type { OverdueSalesPolicy } from "../accounting/creditControl";
import type { StockPolicy } from "../accounting/stockPolicy";
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
  NumberingRule,
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
  /** The firm's custom field definitions (doc 37, T07); loaded where values are saved. */
  customFieldDefs?: CustomFieldDef[];
  /** Logo and signature printed on documents (doc 37, T16); data:image URIs. */
  branding?: { logo: string | null; signature: string | null; version: number };
  /** Credit control (doc 37, T11): what overdue bills do to a new sale. */
  salesControls?: {
    overdueSales: OverdueSalesPolicy;
    /** Stock control (doc 37, T37); missing = "warn". */
    stockPolicy?: StockPolicy;
    version: number;
  };
  firm: Firm;
  parties: Party[];
  items: Item[];
  ledgers: Ledger[];
  vouchers: Voucher[];
  /** Opening balances of other accounts, e.g. furniture. Capital balances them. */
  openingAccounts: OpeningAccount[];
  /** Last used number per voucher type and financial year, e.g. { "sale:26-27": 149 }; "sale:all" when the year is hidden. */
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
  proforma: "PF",
  "sales-order": "SO",
  "delivery-note": "DC",
  "purchase-order": "PO",
};

let idCounter = 0;
export function newId(prefix: string): ID {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** The firm's walk-in customer for retail bills (doc 37, T02). */
export const WALK_IN_PARTY_NAME = "Cash customer";

/** Retail bills' default prefix (doc 37, T02): RI/26-27/0001. */
export const DEFAULT_RETAIL_PREFIX = "RI";

/**
 * Number series: normal, "bos" for sales bills of supply (their own series,
 * e.g. BS/26-27/0001), "nongst" for the non-GST book (NSI), and the retail
 * series (doc 37, T02): "retail" (RI) and "nongst-retail" (NRI).
 */
export type Series = "bos" | "nongst" | "retail" | "nongst-retail";

/** Longest first: "-nongst-retail" also ends with "-retail". */
const SERIES_SUFFIXES: Series[] = ["nongst-retail", "retail", "nongst", "bos"];

export const retailPrefixOf = (
  settings: Pick<InvoiceSettings, "retailPrefix">,
) => settings.retailPrefix || DEFAULT_RETAIL_PREFIX;

export const DEFAULT_NUMBERING: NumberingRule = {
  start: 1,
  digits: 4,
  showYear: true,
};

/** Counter "year" for numbers without a year: one sequence across all years. */
export const ALL_YEARS = "all";

export function numberingRule(
  settings: Pick<InvoiceSettings, "numbering">,
  type: VoucherType,
): NumberingRule {
  return { ...DEFAULT_NUMBERING, ...settings.numbering?.[type] };
}

/** The year a counter belongs to: the financial year, or ALL_YEARS when the year is hidden. */
export function counterYear(rule: NumberingRule, date: ISODate): string {
  return rule.showYear ? financialYear(date).short : ALL_YEARS;
}

export function nextSequence(last: number | undefined, rule: NumberingRule) {
  return Math.max((last ?? 0) + 1, rule.start);
}

export function formatVoucherNumber(
  prefix: string,
  year: string,
  sequence: number,
  rule: NumberingRule,
): string {
  const n = String(sequence).padStart(rule.digits, "0");
  return rule.showYear ? `${prefix}/${year}/${n}` : `${prefix}/${n}`;
}

export function seriesPrefix(
  settings: Pick<
    InvoiceSettings,
    "prefixes" | "billOfSupplyPrefix" | "retailPrefix"
  >,
  type: VoucherType,
  series?: Series,
): string {
  switch (series) {
    case "nongst":
      return `N${settings.prefixes[type]}`;
    case "bos":
      return settings.billOfSupplyPrefix;
    case "retail":
      return retailPrefixOf(settings);
    case "nongst-retail":
      return `N${retailPrefixOf(settings)}`;
    default:
      return settings.prefixes[type];
  }
}

/** "sale-bos:26-27" → the voucher type, series and year of a counter key. */
export function parseCounterKey(key: string): {
  type: VoucherType;
  series?: Series;
  year: string;
} {
  const [typeAndSeries = "", year = ""] = key.split(":");
  const series = SERIES_SUFFIXES.find((s) => typeAndSeries.endsWith(`-${s}`));
  return {
    type: (series
      ? typeAndSeries.slice(0, -series.length - 1)
      : typeAndSeries) as VoucherType,
    series,
    year,
  };
}

/**
 * A stored counter (type, prefix such as "SI" or "RI", year) → the key the core
 * uses, e.g. "sale-retail:26-27"; null for a prefix no series uses any more.
 */
export function counterKeyOf(
  settings: Pick<
    InvoiceSettings,
    "prefixes" | "billOfSupplyPrefix" | "retailPrefix"
  >,
  type: VoucherType,
  prefix: string,
  year: string,
): string | null {
  const series: (Series | undefined)[] =
    type === "sale" ? [undefined, ...SERIES_SUFFIXES] : [undefined, "nongst"];
  const match = series.find((s) => seriesPrefix(settings, type, s) === prefix);
  if (match === undefined && seriesPrefix(settings, type) !== prefix)
    return null;
  return `${type}${match ? `-${match}` : ""}:${year}`;
}

const counterKey = (
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
) =>
  `${type}${series ? `-${series}` : ""}:${counterYear(numberingRule(db.invoiceSettings, type), date)}`;

/** Number the next voucher would get, e.g. "SI/26-27/0150". Does not reserve it. */
export function peekNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const rule = numberingRule(db.invoiceSettings, type);
  const next = nextSequence(
    db.counters[counterKey(db, type, date, series)],
    rule,
  );
  return formatVoucherNumber(
    seriesPrefix(db.invoiceSettings, type, series),
    financialYear(date).short,
    next,
    rule,
  );
}

export function takeNumber(
  db: Db,
  type: VoucherType,
  date: ISODate,
  series?: Series,
): string {
  const number = peekNumber(db, type, date, series);
  const key = counterKey(db, type, date, series);
  db.counters[key] = nextSequence(
    db.counters[key],
    numberingRule(db.invoiceSettings, type),
  );
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
