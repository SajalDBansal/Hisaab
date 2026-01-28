import {
  bankReconciliation,
  type Reconciliation,
} from "../accounting/reconcile";
import { today } from "../dates";
import { setCleared } from "../mock/db";
import type { Ledger } from "../types";
import { clone, delay, getDb } from "./client";

export interface ReconciliationView extends Reconciliation {
  ledger: Ledger;
  asOf: string;
}

export const bankService = {
  /** Real API: http.get<ReconciliationView>(`/banks/${ledgerId}/reconciliation?asOf=${asOf}`) */
  async reconciliation(
    ledgerId: string,
    asOf: string = today(),
  ): Promise<ReconciliationView> {
    await delay();
    const db = getDb();
    const ledger = db.ledgers.find((l) => l.id === ledgerId);
    if (!ledger || ledger.kind !== "bank")
      throw new Error("Pick a bank account");
    return clone({
      ...bankReconciliation(ledger, db.vouchers, asOf),
      ledger,
      asOf,
    });
  },

  /** Tick (date) or untick (null) an entry. Real API: http.patch(`/vouchers/${id}/bank-date`, { date }) */
  async setCleared(
    id: string,
    date: string | null,
    ledgerId?: string,
  ): Promise<void> {
    await delay();
    setCleared(getDb(), id, date, today(), ledgerId);
  },
};
