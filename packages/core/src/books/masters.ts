/** Parties and items. */
import { gstModeOf } from "../accounting/gstMode";
import type { ID, ISODate, Item, ItemInput, Party, PartyInput } from "../types";
import { checkItem, checkParty } from "../validation";
import type { Db } from "./base";
import { newId } from "./base";
// ---------------------------------------------------------------------------
// Parties and items (masters)
// ---------------------------------------------------------------------------

const firstError = (errors: Record<string, string | undefined>) =>
  Object.values(errors).find(Boolean);

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
  if (problem) throw new Error(problem);
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
  if (!party) throw new Error("Party not found");
  const p = cleanParty(input);
  const problem = firstError(checkParty(p, db.parties, id));
  if (problem) throw new Error(problem);
  if (p.type !== party.type && db.vouchers.some((v) => v.partyId === id)) {
    throw new Error(
      `This party already has entries, so it can't be changed to a ${p.type}.`,
    );
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
  const ok = (name: string, was?: string) =>
    db.units.some((u) => u.name === name && (u.enabled || name === was));
  if (!ok(i.unit, current?.unit))
    throw new Error(
      `${i.unit} isn't a switched-on unit. Add it in Settings → Units.`,
    );
  if (i.altUnit && !ok(i.altUnit.name, current?.altUnit?.name)) {
    throw new Error(
      `${i.altUnit.name} isn't a switched-on unit. Add it in Settings → Units.`,
    );
  }
}

export function createItem(db: Db, input: ItemInput): Item {
  const i = cleanItem(input);
  const problem = firstError(
    checkItem(i, db.items, undefined, gstModeOf(db.firm)),
  );
  if (problem) throw new Error(problem);
  checkItemUnits(db, i);
  const item: Item = {
    id: newId("i"),
    ...i,
    openingCost: i.openingCost ?? i.purchasePrice,
    openingBookScope:
      i.openingBookScope ??
      (gstModeOf(db.firm) === "off" || i.taxType === "nongst"
        ? "nongst"
        : "gst"),
  };
  db.items.push(item);
  return item;
}

export function updateItem(db: Db, id: ID, input: ItemInput): Item {
  const item = db.items.find((x) => x.id === id);
  if (!item) throw new Error("Item not found");
  const i = cleanItem(input);
  const problem = firstError(checkItem(i, db.items, id, gstModeOf(db.firm)));
  if (problem) throw new Error(problem);
  checkItemUnits(db, i, item);
  const used = db.vouchers.some((v) => v.lines?.some((l) => l.itemId === id));
  if (
    used &&
    (i.openingStock !== item.openingStock ||
      (i.openingCost !== undefined && i.openingCost !== item.openingCost) ||
      (i.openingBookScope !== undefined &&
        i.openingBookScope !== item.openingBookScope))
  )
    throw new Error("Opening stock is already in use and cannot be changed.");
  i.openingCost = i.openingCost ?? item.openingCost ?? item.purchasePrice;
  i.openingBookScope = i.openingBookScope ?? item.openingBookScope;
  if (used && i.unit !== item.unit) {
    throw new Error(
      "This item is already on bills, so its unit can't be changed.",
    );
  }
  Object.assign(item, i);
  if (!i.altUnit) delete item.altUnit;
  return item;
}
