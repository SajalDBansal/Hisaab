import type { PartyInput, PartyRow } from "@repo/contracts";
import { checkParty, cleanParty, today } from "@repo/core";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { partiesRepo, type PartyRecord } from "./parties.repo";
import {
  editedElsewhere,
  invalidFields,
  isUniqueViolation,
  notFound,
} from "@repo/backend/modules/masters/shared";

export const toPartyRow = (r: PartyRecord): PartyRow => ({
  id: r.id,
  name: r.name,
  type: r.type,
  phone: r.phone,
  city: r.city,
  stateCode: r.stateCode,
  ...(r.gstin ? { gstin: r.gstin } : {}),
  creditDays: r.creditDays,
  creditLimit: r.creditLimit,
  openingBalance: r.openingBalance,
  openingGstBalance: r.openingGstBalance ?? undefined,
  openingDate: r.openingDate,
  openingBills: r.openingBills,
  version: r.version,
  balance: Number(r.balance),
});

/** The same checks the app form runs, plus the ones that need the other parties. */
async function validated(
  db: Pick<Db, "select">,
  firmId: string,
  input: PartyInput,
  exceptId?: string,
) {
  const party = cleanParty(input);
  const others = await partiesRepo.clashes(db, firmId, party, exceptId);
  const problems = checkParty(
    party,
    others.map((o) => ({
      ...o,
      gstin: o.gstin ?? undefined,
      openingGstBalance: o.openingGstBalance ?? undefined,
    })),
    exceptId,
  );
  const error = invalidFields(problems);
  if (error) throw error;
  return party;
}

const columnsOf = (p: PartyInput) => ({
  name: p.name,
  type: p.type,
  phone: p.phone,
  city: p.city,
  stateCode: p.stateCode,
  gstin: p.gstin || null,
  creditDays: p.creditDays,
  creditLimit: p.creditLimit,
  openingBalance: p.openingBalance,
});

const duplicate = () =>
  new AppError("DUPLICATE", "A party with this name already exists.", 409, {
    name: "A party with this name already exists.",
  });

export const partiesService = {
  async create(db: Db, firmId: string, input: PartyInput) {
    return withFirmWrite(db, firmId, async (tx) => {
      const party = await validated(tx, firmId, input);
      const id = uuidv7();
      try {
        await partiesRepo.insert(tx, {
          id,
          firmId,
          ...columnsOf(party),
          openingDate: today(),
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate();
        throw err;
      }
      const row = await partiesRepo.get(tx, firmId, id);
      if (!row) throw notFound("party");
      return toPartyRow(row);
    });
  },

  async update(
    db: Db,
    firmId: string,
    id: string,
    version: number,
    input: PartyInput,
  ) {
    return withFirmWrite(db, firmId, async (db) => {
      const current = await partiesRepo.get(db, firmId, id);
      if (!current) throw notFound("party");
      const party = await validated(db, firmId, input, id);
      if (
        current.openingBills?.length &&
        (party.openingBalance !== current.openingBalance ||
          party.type !== current.type)
      )
        throw new AppError(
          "IMPORTED_OPENING_IMMUTABLE",
          "Imported opening bills fix this party's opening balance and type.",
          409,
        );
      if (
        current.openingGstBalance !== null &&
        party.openingBalance !== current.openingBalance
      )
        throw new AppError(
          "OPENING_ALLOCATED",
          "Reset the opening allocation to the default book before changing its total.",
          409,
        );
      if (
        party.type !== current.type &&
        (await partiesRepo.hasEntries(db, firmId, id))
      )
        throw new AppError(
          "PARTY_IN_USE",
          `This party already has entries, so it can't be changed to a ${party.type}.`,
          409,
        );
      let saved: boolean;
      try {
        saved = await partiesRepo.update(
          db,
          firmId,
          id,
          version,
          columnsOf(party),
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate();
        throw err;
      }
      if (!saved) throw editedElsewhere("party");
      const row = await partiesRepo.get(db, firmId, id);
      if (!row) throw notFound("party");
      return toPartyRow(row);
    });
  },

  async remove(db: Db, firmId: string, id: string, version: number) {
    return withFirmWrite(db, firmId, async (db) => {
      if (!(await partiesRepo.get(db, firmId, id))) throw notFound("party");
      if (await partiesRepo.hasEntries(db, firmId, id))
        throw new AppError(
          "PARTY_IN_USE",
          "This party has entries, so it can't be deleted.",
          409,
        );
      if (!(await partiesRepo.softDelete(db, firmId, id, version)))
        throw editedElsewhere("party");
    });
  },
};
