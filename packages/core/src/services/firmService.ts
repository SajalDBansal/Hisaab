import { financialYear, today } from "../dates";
import { blankBooks } from "../mock/seed";
import { newId } from "../mock/db";
import { checkNewFirm } from "../validation";
import type { Firm, NewFirmInput } from "../types";
import {
  addBooks,
  clone,
  delay,
  getAllBooks,
  getDb,
  setActiveFirm,
} from "./client";

export interface FirmWithYear extends Firm {
  /** e.g. "2026-27" */
  fyLabel: string;
}

export interface FirmRow {
  firm: Firm;
  active: boolean;
  parties: number;
  vouchers: number;
}

export const firmService = {
  /** Real API: http.get<FirmWithYear>("/firms/current") */
  async getCurrent(): Promise<FirmWithYear> {
    await delay();
    const firm = getDb().firm;
    return clone({ ...firm, fyLabel: financialYear(today()).label });
  },

  /** Every firm this user can open. Real API: http.get<FirmRow[]>("/firms") */
  async list(): Promise<FirmRow[]> {
    await delay();
    const current = getDb().firm.id;
    return clone(
      getAllBooks().map((b) => ({
        firm: b.firm,
        active: b.firm.id === current,
        parties: b.parties.length,
        vouchers: b.vouchers.length,
      })),
    );
  },

  /** Open another firm's books. Real API: the app sends the firm id with every request (X-Firm-Id header). */
  async switchTo(id: string): Promise<void> {
    await delay();
    setActiveFirm(id);
  },

  /** Start books for another business and open them. Real API: http.post<Firm>("/firms", input) */
  async create(input: NewFirmInput): Promise<Firm> {
    await delay();
    const problem = Object.values(checkNewFirm(input))[0];
    if (problem) throw new Error(problem);
    if (
      getAllBooks().some(
        (b) => b.firm.name.toLowerCase() === input.name.trim().toLowerCase(),
      )
    )
      throw new Error("You already have a firm with this name.");
    const db = blankBooks({ ...input, id: newId("firm") });
    addBooks(db);
    setActiveFirm(db.firm.id);
    return clone(db.firm);
  },
};
