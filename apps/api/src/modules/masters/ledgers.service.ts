import type { LedgerInput, LedgerRow } from "@repo/contracts";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { ledgersRepo, type LedgerRecord } from "./ledgers.repo";
import { editedElsewhere, isUniqueViolation, notFound } from "@repo/backend/modules/masters/shared";

export const toLedgerRow = (r: LedgerRecord): LedgerRow => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  shortName: r.shortName,
  openingBalance: r.openingBalance,
  openingGstBalance: r.openingGstBalance ?? undefined,
  version: r.version,
  balance: Number(r.balance),
});

const taken = () =>
  new AppError("DUPLICATE", "An account with this name already exists.", 409, {
    name: "An account with this name already exists.",
  });

export const ledgersService = {
  async create(db: Db, firmId: string, input: LedgerInput) {
    if (await ledgersRepo.nameTaken(db, firmId, input.name)) throw taken();
    const id = uuidv7();
    try {
      await ledgersRepo.insert(db, { id, firmId, ...input });
    } catch (err) {
      if (isUniqueViolation(err)) throw taken();
      throw err;
    }
    const row = await ledgersRepo.get(db, firmId, id);
    if (!row) throw notFound("account");
    return toLedgerRow(row);
  },

  async update(
    db: Db,
    firmId: string,
    id: string,
    version: number,
    input: LedgerInput,
  ) {
    return withFirmWrite(db, firmId, async (db) => {
      const current = await ledgersRepo.get(db, firmId, id);
      if (!current) throw notFound("account");
      if (current.openingGstBalance !== null && input.openingBalance !== current.openingBalance)
        throw new AppError("OPENING_ALLOCATED", "Reset the opening allocation to the default book before changing its total.", 409);
      if (await ledgersRepo.nameTaken(db, firmId, input.name, id))
        throw taken();
      if (input.kind !== current.kind) {
        const used = await ledgersRepo.usedBy(db, firmId, id);
        if (used.entries)
          throw new AppError(
            "ACCOUNT_IN_USE",
            "This account already has entries, so it can't change between cash and bank.",
            409,
          );
      }
      let saved: boolean;
      try {
        saved = await ledgersRepo.update(db, firmId, id, version, input);
      } catch (err) {
        if (isUniqueViolation(err)) throw taken();
        throw err;
      }
      if (!saved) throw editedElsewhere("account");
      const row = await ledgersRepo.get(db, firmId, id);
      if (!row) throw notFound("account");
      return toLedgerRow(row);
    });
  },

  async remove(db: Db, firmId: string, id: string, version: number) {
    return withFirmWrite(db, firmId, async (db) => {
      if (!(await ledgersRepo.get(db, firmId, id))) throw notFound("account");
      const used = await ledgersRepo.usedBy(db, firmId, id);
      if (used.entries)
        throw new AppError(
          "ACCOUNT_IN_USE",
          "This account has entries, so it can't be deleted.",
          409,
        );
      if (used.onInvoices)
        throw new AppError(
          "ACCOUNT_IN_USE",
          "This account's bank details are printed on your invoices. Pick another account in invoice settings first.",
          409,
        );
      if (
        !(await ledgersRepo.update(db, firmId, id, version, {
          deletedAt: new Date(),
        }))
      )
        throw editedElsewhere("account");
    });
  },
};
