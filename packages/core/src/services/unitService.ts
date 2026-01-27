import { addUnit, removeUnit, setUnitEnabled, unitUsage } from "../mock/db";
import type { UnitDef } from "../types";
import { clone, delay, getDb } from "./client";

export interface UnitRow extends UnitDef {
  /** Number of items using this unit (as main or second unit). */
  itemCount: number;
}

export const unitService = {
  /** All units, switched-on first. Real API: http.get<UnitRow[]>("/units") */
  async list(): Promise<UnitRow[]> {
    await delay();
    const db = getDb();
    const usage = unitUsage(db);
    return clone(
      db.units
        .map((u) => ({ ...u, itemCount: usage[u.name] ?? 0 }))
        .sort((a, b) => Number(b.enabled) - Number(a.enabled)),
    );
  },

  /** Real API: http.post<UnitDef>("/units", input) */
  async add(input: { name: string; uqc: string }): Promise<UnitDef> {
    await delay();
    return clone(addUnit(getDb(), input));
  },

  /** Real API: http.patch<UnitDef>(`/units/${encodeURIComponent(name)}`, { enabled }) */
  async setEnabled(name: string, enabled: boolean): Promise<UnitDef> {
    await delay();
    return clone(setUnitEnabled(getDb(), name, enabled));
  },

  /** Real API: http.delete(`/units/${encodeURIComponent(name)}`) */
  async remove(name: string): Promise<void> {
    await delay();
    removeUnit(getDb(), name);
  },
};
