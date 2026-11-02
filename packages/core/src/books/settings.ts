/** Firm settings, team, documents, units, bank reconciliation, reminders and notices. */
import { bankClearedOn } from "../accounting/reconcile";
import { ledgerEffect } from "../accounting/reports";
import { formatDate } from "../dates";
import type {
  Firm,
  FirmUpdate,
  ID,
  InvoiceSettings,
  ISODate,
  NewDocumentInput,
  ReminderSettings,
  StoredDocument,
  TeamMember,
  UnitDef,
  Voucher,
} from "../types";
import { checkUnit } from "../units";
import { checkNewFirm } from "../validation";
import type { Db } from "./base";
import { findParty, logAudit, newId } from "./base";
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
    if (next.gstRegistration === "unregistered") next.gstin = "";
    const problem = checkNewFirm({
      name: next.name,
      city: next.city,
      stateCode: next.stateCode,
      gstin: next.gstin,
      gstRegistration: next.gstRegistration,
    }).gstin;
    if (problem) throw new Error(problem);
  }
  if (next.gstRegistration === "composition") next.compositionType ??= "trader";
  else delete next.compositionType;
  db.firm = next;
  return db.firm;
}

export function updateInvoiceSettings(
  db: Db,
  patch: Partial<InvoiceSettings>,
): InvoiceSettings {
  if (patch.prefixes) {
    for (const [type, prefix] of Object.entries(patch.prefixes)) {
      if (!/^[A-Z0-9-]{1,5}$/.test(prefix))
        throw new Error(
          `Prefix for ${type} must be 1–5 capital letters or digits.`,
        );
    }
  }
  if (
    patch.billOfSupplyPrefix !== undefined &&
    !/^[A-Z0-9-]{1,5}$/.test(patch.billOfSupplyPrefix)
  ) {
    throw new Error(
      "Bill of supply prefix must be 1–5 capital letters or digits.",
    );
  }
  const next = {
    ...db.invoiceSettings,
    ...patch,
    prefixes: { ...db.invoiceSettings.prefixes, ...patch.prefixes },
  };
  const salePrefix = next.prefixes.sale;
  if (
    next.billOfSupplyPrefix === salePrefix ||
    next.billOfSupplyPrefix === `N${salePrefix}`
  )
    throw new Error(
      "Tax invoice, non-GST invoice and bill of supply prefixes must be different.",
    );
  db.invoiceSettings = next;
  return db.invoiceSettings;
}

export function updateMember(
  db: Db,
  id: ID,
  patch: Partial<Pick<TeamMember, "role" | "active">>,
): TeamMember {
  const member = db.team.find((m) => m.id === id);
  if (!member) throw new Error("Team member not found");
  const owners = db.team.filter((m) => m.role === "owner" && m.active);
  if (
    member.role === "owner" &&
    owners.length === 1 &&
    ((patch.role && patch.role !== "owner") || patch.active === false)
  ) {
    throw new Error("Keep at least one owner.");
  }
  Object.assign(member, patch);
  return member;
}

export function inviteMember(
  db: Db,
  input: { email: string; role: Exclude<TeamMember["role"], "owner"> },
): TeamMember {
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

export function addDocument(
  db: Db,
  input: NewDocumentInput,
  date: ISODate,
): StoredDocument {
  if (!input.name.trim()) throw new Error("Enter a file name.");
  // Mock size; the real API stores the uploaded file and returns its size.
  const doc: StoredDocument = {
    id: newId("doc"),
    ...input,
    name: input.name.trim(),
    sizeKb: 120 + Math.floor(Math.random() * 600),
    uploadedOn: date,
  };
  db.documents.unshift(doc);
  return doc;
}

export function removeDocument(db: Db, id: ID): void {
  db.documents = db.documents.filter((d) => d.id !== id);
}

// ---------------------------------------------------------------------------
// Units of measure
// ---------------------------------------------------------------------------

const unitInUse = (db: Db, name: string) =>
  db.items.filter((i) => i.unit === name || i.altUnit?.name === name).length;

export function addUnit(db: Db, input: { name: string; uqc: string }): UnitDef {
  const problem = checkUnit(input, db.units);
  if (problem) throw new Error(problem);
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
export function setUnitEnabled(
  db: Db,
  name: string,
  enabled: boolean,
): UnitDef {
  const unit = db.units.find((u) => u.name === name);
  if (!unit) throw new Error("Unit not found");
  if (!enabled && db.units.filter((u) => u.enabled).length === 1)
    throw new Error("Keep at least one unit switched on.");
  unit.enabled = enabled;
  return unit;
}

/** Only units you added yourself, and only when no item uses them. */
export function removeUnit(db: Db, name: string): void {
  const unit = db.units.find((u) => u.name === name);
  if (!unit) throw new Error("Unit not found");
  if (unit.builtIn)
    throw new Error("Built-in units can be switched off but not deleted.");
  const n = unitInUse(db, name);
  if (n)
    throw new Error(
      `${n} item${n > 1 ? "s use" : " uses"} ${name}. Change those items first.`,
    );
  db.units = db.units.filter((u) => u.name !== name);
}

export function unitUsage(db: Db): Record<string, number> {
  return Object.fromEntries(
    db.units.map((u) => [u.name, unitInUse(db, u.name)]),
  );
}

// ---------------------------------------------------------------------------
// Bank reconciliation, reminders, notifications
// ---------------------------------------------------------------------------

/** Mark a bank entry as seen in the bank statement on `date`, or clear the mark (null). */
export function setCleared(
  db: Db,
  id: ID,
  date: ISODate | null,
  todayIso: ISODate,
  ledgerId?: string,
): Voucher {
  const v = db.vouchers.find((x) => x.id === id);
  if (!v) throw new Error("Entry not found");
  const bank = db.ledgers.find(
    (l) =>
      l.kind === "bank" &&
      (ledgerId
        ? l.id === ledgerId
        : l.id === v.ledgerId || l.id === v.toLedgerId),
  );
  if (!bank || !ledgerEffect(v, bank.id) || v.status !== "posted")
    throw new Error("Pick a bank used by this posted entry.");
  const legacyBank =
    db.ledgers.find((l) => l.kind === "bank" && l.id === v.ledgerId) ??
    db.ledgers.find((l) => l.kind === "bank" && l.id === v.toLedgerId);
  const clearings =
    v.bankClearings ??
    (v.clearedOn && legacyBank ? { [legacyBank.id]: v.clearedOn } : {});
  const was = bankClearedOn(v, bank.id);
  const change = (now?: ISODate) =>
    logAudit(db, "bank-date", v, [
      {
        field: `Bank date: ${bank.name}`,
        before: was ? formatDate(was) : "—",
        after: now ? formatDate(now) : "—",
      },
    ]);
  if (date === null) {
    v.bankClearings = { ...clearings };
    delete v.bankClearings[bank.id];
    if (!ledgerId || bank.id === v.ledgerId) delete v.clearedOn;
    if (was) change(undefined);
    return v;
  }
  if (date < v.date)
    throw new Error("The bank date can't be before the entry date.");
  if (date > todayIso) throw new Error("The bank date can't be in the future.");
  v.bankClearings = { ...clearings, [bank.id]: date };
  if (!ledgerId || bank.id === v.ledgerId) v.clearedOn = date;
  if (was !== date) change(date);
  return v;
}

export function updateReminders(
  db: Db,
  patch: Partial<ReminderSettings>,
): ReminderSettings {
  const next = { ...db.reminders, ...patch };
  for (const k of ["daysBefore", "repeatEvery"] as const) {
    if (!Number.isInteger(next[k]) || next[k] < 0 || next[k] > 60)
      throw new Error("Days must be a whole number from 0 to 60.");
  }
  if (next.minAmount < 0) throw new Error("Minimum amount can't be negative.");
  db.reminders = next;
  return next;
}

export function markReminded(db: Db, partyId: ID, date: ISODate): void {
  findParty(db, partyId);
  db.remindedOn[partyId] = date;
}

export function markNoticesRead(db: Db, ids: string[]): void {
  db.readNotices = [...new Set([...db.readNotices, ...ids])].slice(-500);
}
