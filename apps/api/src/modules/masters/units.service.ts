import type { NewUnitInput, UnitRow } from "@repo/contracts";
import { checkUnit } from "@repo/core";
import { AppError } from "@repo/backend/lib/app-error";
import type { Db } from "@repo/backend/db/client";
import { unitsRepo } from "./units.repo";
import { isUniqueViolation, notFound } from "@repo/backend/modules/masters/shared";

const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export const unitsService = {
  async list(db: Db, firmId: string): Promise<UnitRow[]> {
    const [units, usage] = await Promise.all([
      unitsRepo.list(db, firmId),
      unitsRepo.usage(db, firmId),
    ]);
    return units.map((u) => ({
      name: u.name,
      uqc: u.uqc,
      enabled: u.enabled,
      builtIn: u.builtIn,
      itemCount: usage[u.name] ?? 0,
    }));
  },

  async add(db: Db, firmId: string, input: NewUnitInput): Promise<UnitRow> {
    const all = await unitsRepo.list(db, firmId);
    const problem = checkUnit(input, all);
    if (problem)
      throw new AppError("INVALID_INPUT", problem, 400, { name: problem });
    const name = capital(input.name.trim());
    try {
      await unitsRepo.insert(db, {
        firmId,
        name,
        uqc: input.uqc,
        enabled: true,
        builtIn: false,
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw new AppError("DUPLICATE", `${name} is already in the list.`, 409);
      throw err;
    }
    return {
      name,
      uqc: input.uqc,
      enabled: true,
      builtIn: false,
      itemCount: 0,
    };
  },

  /** Switching off only hides a unit for new items; items already using it keep it. */
  async setEnabled(db: Db, firmId: string, name: string, enabled: boolean) {
    const unit = await unitsRepo.get(db, firmId, name);
    if (!unit) throw notFound("unit");
    if (!enabled) {
      const all = await unitsRepo.list(db, firmId);
      if (all.filter((u) => u.enabled).length <= 1)
        throw new AppError(
          "LAST_UNIT",
          "Keep at least one unit switched on.",
          409,
        );
    }
    await unitsRepo.setEnabled(db, firmId, name, enabled);
    const fresh = (await unitsService.list(db, firmId)).find(
      (u) => u.name === name,
    );
    if (!fresh) throw notFound("unit");
    return fresh;
  },

  /** Only units you added yourself, and only when no item uses them. */
  async remove(db: Db, firmId: string, name: string) {
    const unit = await unitsRepo.get(db, firmId, name);
    if (!unit) throw notFound("unit");
    if (unit.builtIn)
      throw new AppError(
        "UNIT_BUILT_IN",
        "Built-in units can be switched off but not deleted.",
        409,
      );
    const used = (await unitsRepo.usage(db, firmId))[name] ?? 0;
    if (used > 0)
      throw new AppError(
        "UNIT_IN_USE",
        `${used} item${used > 1 ? "s use" : " uses"} ${name}. Change those items first.`,
        409,
      );
    await unitsRepo.remove(db, firmId, name);
  },
};
