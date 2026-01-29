import { lastMonths, today } from "../dates";
import {
  gstMonth,
  gstr1,
  gstr3b,
  type GstMonth,
  type Gstr1,
  type Gstr3b,
} from "../accounting/gst";
import {
  compositionQuarter,
  type CompositionQuarter,
} from "../accounting/gstMode";
import { addDays } from "../dates";
import { clone, delay, getDb } from "./client";

export const gstService = {
  /** Summary for the last few months, newest first. Real API: http.get<GstMonth[]>("/gst/months?count=4") */
  async months(count = 4): Promise<GstMonth[]> {
    await delay();
    const { vouchers } = getDb();
    return clone(
      lastMonths(today(), count)
        .reverse()
        .map((m) => gstMonth(vouchers, m)),
    );
  },

  /** Real API: http.get<Gstr1>(`/gst/gstr1?month=${month}`) */
  async gstr1(month: string): Promise<Gstr1> {
    await delay();
    const { vouchers, parties, items, units } = getDb();
    return clone(gstr1(vouchers, parties, items, month, units));
  },

  /**
   * Composition firms: this quarter so far and the last four quarters, newest first (CMP-08 figures).
   * Real API: http.get<CompositionQuarter[]>("/gst/composition?count=5")
   */
  async compositionQuarters(count = 5): Promise<CompositionQuarter[]> {
    await delay();
    const { vouchers, firm } = getDb();
    const out: CompositionQuarter[] = [];
    let date = today();
    for (let i = 0; i < count; i++) {
      const q = compositionQuarter(vouchers, date, firm.compositionType);
      out.push(q);
      date = addDays(`${q.months[0]}-01`, -1);
    }
    return clone(out);
  },

  /** Real API: http.get<Gstr3b>(`/gst/gstr3b?month=${month}`) */
  async gstr3b(month: string): Promise<Gstr3b> {
    await delay();
    return clone(gstr3b(getDb().vouchers, month));
  },
};
