import {
  checkSalesperson,
  salespersonOfUser,
  type Salesperson,
  type SalespersonInput,
} from "../catalog";
import { newId } from "../books/base";
import { clone, delay, getDb } from "./client";

/** The firm's salespersons and which one is the person using the app. */
export interface SalespersonList {
  rows: Salesperson[];
  /** The active salesperson linked to this login (the sales forms' default). */
  mine: string | null;
}

function fieldError(problems: Record<string, string>) {
  const first = Object.values(problems)[0];
  if (first) throw new Error(first);
}

/** In-app demo of the catalogue settings (doc 37, Phase 2); the API applies the same rules. */
export const catalogService = {
  /** Real API: GET /settings/salespersons */
  async salespersons(): Promise<SalespersonList> {
    await delay();
    const db = getDb();
    const rows = db.salespersons ?? [];
    return clone({
      rows,
      mine: salespersonOfUser(rows, db.currentUserId)?.id ?? null,
    });
  },

  /** Real API: POST /settings/salespersons, or PUT …/:id with If-Match. */
  async saveSalesperson(
    input: SalespersonInput,
    id?: string,
    _version?: number,
  ): Promise<Salesperson> {
    void _version;
    await delay();
    const db = getDb();
    const rows = (db.salespersons ??= []);
    if (input.userId && !db.team.some((m) => m.id === input.userId))
      throw new Error("Pick a member of this firm.");
    fieldError(checkSalesperson(input, rows, id));
    const fields = {
      name: input.name.trim(),
      userId: input.userId ?? undefined,
      phone: input.phone?.trim() || undefined,
      active: input.active,
    };
    if (id) {
      const row = rows.find((s) => s.id === id);
      if (!row) throw new Error("That salesperson was not found.");
      Object.assign(row, fields, { version: (row.version ?? 1) + 1 });
      return clone(row);
    }
    const row: Salesperson = { id: newId("sp"), ...fields, version: 1 };
    rows.push(row);
    return clone(row);
  },
};
