/**
 * In-memory mock database.
 *
 * Holds all data while the app runs and contains the "write" logic
 * (create sale, create receipt …). The real backend will do the same work
 * on the server; until then the services in `src/services` call these functions.
 * Data resets when the app reloads.
 */
import type { OpeningAccount } from "../accounting/generalLedger";
import type { CustomAccount } from "../accounting/accounts";
import { gstModeOf } from "../accounting/gstMode";
import { checkUnit } from "../units";
import { checkItem, checkNewFirm, checkParty } from "../validation";
import type { AuditEntry, Firm, FirmUpdate, ID, InvoiceSettings, ItemInput, PartyInput, ReminderSettings, StoredDocument, TeamMember, UnitDef, ISODate, Item, Ledger, Party, Voucher, VoucherType } from "../types";
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
export function findParty(db: Db, id: ID): Party {
    const party = db.parties.find((p) => p.id === id);
    if (!party)
        throw new Error(`Party not found: ${id}`);
    return party;
}
interface CreateOptions {
    /** Only the historical demo importer uses this; API inputs cannot enable it. */
    legacyStock?: boolean;
    pendingSync?: boolean;
    status?: Voucher["status"];
}
// ---------------------------------------------------------------------------
// Settings, team and documents
// ---------------------------------------------------------------------------
export function updateFirm(db: Db, patch: FirmUpdate): Firm {
    if (patch.name !== undefined && !patch.name.trim())
        throw new Error("Firm name can't be empty.");
    const next = { ...db.firm, ...patch };
    // GST setting: a GSTIN is needed for regular and composition, and none without GST.
    // New bills follow the new setting; bills already saved keep theirs.
    if (patch.gstRegistration !== undefined || patch.gstin !== undefined) {
        if (next.gstRegistration === "unregistered")
            next.gstin = "";
        const problem = checkNewFirm({
            name: next.name,
            city: next.city,
            stateCode: next.stateCode,
            gstin: next.gstin,
            gstRegistration: next.gstRegistration,
        }).gstin;
        if (problem)
            throw new Error(problem);
    }
    if (next.gstRegistration === "composition")
        next.compositionType ??= "trader";
    else
        delete next.compositionType;
    db.firm = next;
    return db.firm;
}
export function updateInvoiceSettings(db: Db, patch: Partial<InvoiceSettings>): InvoiceSettings {
    if (patch.prefixes) {
        for (const [type, prefix] of Object.entries(patch.prefixes)) {
            if (!/^[A-Z0-9-]{1,5}$/.test(prefix))
                throw new Error(`Prefix for ${type} must be 1–5 capital letters or digits.`);
        }
    }
    if (patch.billOfSupplyPrefix !== undefined &&
        !/^[A-Z0-9-]{1,5}$/.test(patch.billOfSupplyPrefix)) {
        throw new Error("Bill of supply prefix must be 1–5 capital letters or digits.");
    }
    const next = {
        ...db.invoiceSettings,
        ...patch,
        prefixes: { ...db.invoiceSettings.prefixes, ...patch.prefixes },
    };
    const salePrefix = next.prefixes.sale;
    if (next.billOfSupplyPrefix === salePrefix ||
        next.billOfSupplyPrefix === `N${salePrefix}`)
        throw new Error("Tax invoice, non-GST invoice and bill of supply prefixes must be different.");
    db.invoiceSettings = next;
    return db.invoiceSettings;
}
export function updateMember(db: Db, id: ID, patch: Partial<Pick<TeamMember, "role" | "active">>): TeamMember {
    const member = db.team.find((m) => m.id === id);
    if (!member)
        throw new Error("Team member not found");
    const owners = db.team.filter((m) => m.role === "owner" && m.active);
    if (member.role === "owner" &&
        owners.length === 1 &&
        ((patch.role && patch.role !== "owner") || patch.active === false)) {
        throw new Error("Keep at least one owner.");
    }
    Object.assign(member, patch);
    return member;
}
export function inviteMember(db: Db, input: {
    email: string;
    role: Exclude<TeamMember["role"], "owner">;
}): TeamMember {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email.");
    if (db.team.some((m) => m.email?.toLowerCase() === email))
        throw new Error("This email is already in the team.");
    const member: TeamMember = {
        id: newId("u"),
        name: email,
        email,
        phone: "",
        role: input.role,
        active: false,
    };
    db.team.push(member);
    return member;
}
// ---------------------------------------------------------------------------
// Parties and items (masters)
// ---------------------------------------------------------------------------
const firstError = (errors: Record<string, string | undefined>) => Object.values(errors).find(Boolean);
/** Tidy what the form sent: trim text, keep only digits in the phone, drop an empty GSTIN. */
export function cleanParty(input: PartyInput): PartyInput {
    return {
        ...input,
        name: input.name.trim(),
        city: input.city.trim(),
        phone: input.phone.replace(/\D/g, ""),
        gstin: input.gstin?.trim().toUpperCase() || undefined,
    };
}
export function createParty(db: Db, input: PartyInput, date: ISODate): Party {
    const p = cleanParty(input);
    const problem = firstError(checkParty(p, db.parties));
    if (problem)
        throw new Error(problem);
    const party: Party = {
        id: newId(p.type === "customer" ? "c" : "s"),
        ...p,
        openingDate: date,
    };
    db.parties.push(party);
    return party;
}
export function updateParty(db: Db, id: ID, input: PartyInput): Party {
    const party = db.parties.find((x) => x.id === id);
    if (!party)
        throw new Error("Party not found");
    const p = cleanParty(input);
    const problem = firstError(checkParty(p, db.parties, id));
    if (problem)
        throw new Error(problem);
    if (p.type !== party.type && db.vouchers.some((v) => v.partyId === id)) {
        throw new Error(`This party already has entries, so it can't be changed to a ${p.type}.`);
    }
    Object.assign(party, p);
    return party;
}
export function cleanItem(input: ItemInput): ItemInput {
    return {
        ...input,
        name: input.name.trim(),
        code: input.code.trim().toUpperCase(),
        group: input.group.trim() || "General",
        gstRate: input.taxType === "taxable" ? input.gstRate : 0,
        hsn: input.hsn.trim(),
        altUnit: input.altUnit?.name.trim()
            ? { name: input.altUnit.name.trim(), factor: input.altUnit.factor }
            : undefined,
    };
}
/** Units must be in the firm's list and switched on (an item may keep a unit that was switched off later). */
function checkItemUnits(db: Db, i: ItemInput, current?: Item) {
    const ok = (name: string, was?: string) => db.units.some((u) => u.name === name && (u.enabled || name === was));
    if (!ok(i.unit, current?.unit))
        throw new Error(`${i.unit} isn't a switched-on unit. Add it in Settings → Units.`);
    if (i.altUnit && !ok(i.altUnit.name, current?.altUnit?.name)) {
        throw new Error(`${i.altUnit.name} isn't a switched-on unit. Add it in Settings → Units.`);
    }
}
export function createItem(db: Db, input: ItemInput): Item {
    const i = cleanItem(input);
    const problem = firstError(checkItem(i, db.items, undefined, gstModeOf(db.firm)));
    if (problem)
        throw new Error(problem);
    checkItemUnits(db, i);
    const item: Item = {
        id: newId("i"),
        ...i,
        openingCost: i.openingCost ?? i.purchasePrice,
        openingBookScope: i.openingBookScope ??
            (gstModeOf(db.firm) === "off" || i.taxType === "nongst"
                ? "nongst"
                : "gst"),
    };
    db.items.push(item);
    return item;
}
export function updateItem(db: Db, id: ID, input: ItemInput): Item {
    const item = db.items.find((x) => x.id === id);
    if (!item)
        throw new Error("Item not found");
    const i = cleanItem(input);
    const problem = firstError(checkItem(i, db.items, id, gstModeOf(db.firm)));
    if (problem)
        throw new Error(problem);
    checkItemUnits(db, i, item);
    const used = db.vouchers.some((v) => v.lines?.some((l) => l.itemId === id));
    if (used &&
        (i.openingStock !== item.openingStock ||
            (i.openingCost !== undefined && i.openingCost !== item.openingCost) ||
            (i.openingBookScope !== undefined &&
                i.openingBookScope !== item.openingBookScope)))
        throw new Error("Opening stock is already in use and cannot be changed.");
    i.openingCost = i.openingCost ?? item.openingCost ?? item.purchasePrice;
    i.openingBookScope = i.openingBookScope ?? item.openingBookScope;
    if (used && i.unit !== item.unit) {
        throw new Error("This item is already on bills, so its unit can't be changed.");
    }
    Object.assign(item, i);
    if (!i.altUnit)
        delete item.altUnit;
    return item;
}
// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------
const unitInUse = (db: Db, name: string) => db.items.filter((i) => i.unit === name || i.altUnit?.name === name).length;
export function addUnit(db: Db, input: {
    name: string;
    uqc: string;
}): UnitDef {
    const problem = checkUnit(input, db.units);
    if (problem)
        throw new Error(problem);
    const name = input.name.trim();
    const unit: UnitDef = {
        name: name[0].toUpperCase() + name.slice(1),
        uqc: input.uqc,
        enabled: true,
        builtIn: false,
    };
    db.units.push(unit);
    return unit;
}
/** Switching a unit off only hides it for new items; items already using it keep it. */
export function setUnitEnabled(db: Db, name: string, enabled: boolean): UnitDef {
    const unit = db.units.find((u) => u.name === name);
    if (!unit)
        throw new Error("Unit not found");
    if (!enabled && db.units.filter((u) => u.enabled).length === 1)
        throw new Error("Keep at least one unit switched on.");
    unit.enabled = enabled;
    return unit;
}
/** Only units you added yourself, and only when no item uses them. */
export function removeUnit(db: Db, name: string): void {
    const unit = db.units.find((u) => u.name === name);
    if (!unit)
        throw new Error("Unit not found");
    if (unit.builtIn)
        throw new Error("Built-in units can be switched off but not deleted.");
    const n = unitInUse(db, name);
    if (n)
        throw new Error(`${n} item${n > 1 ? "s use" : " uses"} ${name}. Change those items first.`);
    db.units = db.units.filter((u) => u.name !== name);
}
export function unitUsage(db: Db): Record<string, number> {
    return Object.fromEntries(db.units.map((u) => [u.name, unitInUse(db, u.name)]));
}
