import {
  addDays,
  compositionQuarter,
  gstMonth,
  gstr1,
  gstr3b,
  lastMonths,
  today,
  type CompositionQuarter,
} from "@repo/core";
import type { Db } from "@repo/backend/db/client";
import { loadReportBooks } from "@repo/backend/modules/reports/books";

export const gstService = {
  /** Summary cards for the last few GST months, newest first. */
  async months(db: Db, firmId: string, count: number) {
    const { vouchers } = await loadReportBooks(db, firmId);
    return lastMonths(today(), count)
      .reverse()
      .map((month) => gstMonth(vouchers, month));
  },

  /** GSTR-1 report figures for one month. */
  async gstr1(db: Db, firmId: string, month: string) {
    const { vouchers, parties, items, units } = await loadReportBooks(
      db,
      firmId,
    );
    return gstr1(vouchers, parties, items, month, units);
  },

  /** GSTR-3B report figures for one month. */
  async gstr3b(db: Db, firmId: string, month: string) {
    const { vouchers } = await loadReportBooks(db, firmId);
    return gstr3b(vouchers, month);
  },

  /** CMP-08 figures for this and previous composition quarters. */
  async composition(db: Db, firmId: string, count: number) {
    const { vouchers, firm } = await loadReportBooks(db, firmId);
    const quarters: CompositionQuarter[] = [];
    let date = today();

    for (let i = 0; i < count; i++) {
      const quarter = compositionQuarter(vouchers, date, firm.compositionType);
      quarters.push(quarter);
      date = addDays(`${quarter.months[0]}-01`, -1);
    }

    return quarters;
  },
};
