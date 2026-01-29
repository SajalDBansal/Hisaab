import { openBills, partyBalance, collectionBills } from "../accounting/bills";
import { today } from "../dates";
import { reminderText, voucherShareText } from "../print/messages";
import { voucherHtml, type Printable } from "../print/voucherHtml";
import type { InvoiceTemplate } from "../types";
import { clone, delay, getDb } from "./client";

export interface PrintableVoucher extends Printable {
  /** Message to send with the PDF. */
  shareText: string;
  /** Party's mobile (digits only), for WhatsApp. */
  phone?: string;
}

export const printService = {
  /**
   * Printable invoice / receipt / note. `template` previews another format without saving it.
   * Real API: http.get<PrintableVoucher>(`/vouchers/${id}/print?template=${template ?? ""}`)
   * (or a PDF URL the app downloads).
   */
  async voucher(
    id: string,
    template?: InvoiceTemplate,
  ): Promise<PrintableVoucher> {
    await delay();
    const db = getDb();
    const voucher = db.vouchers.find((v) => v.id === id);
    if (!voucher) throw new Error("Voucher not found");
    const party = db.parties.find((p) => p.id === voucher.partyId);
    const settings = {
      ...db.invoiceSettings,
      ...(template ? { template } : {}),
    };
    const against = db.vouchers.find((v) => v.id === voucher.againstId);
    const itemIds = new Set((voucher.lines ?? []).map((l) => l.itemId));
    const printable = voucherHtml({
      firm: db.firm,
      voucher,
      party,
      items: db.items.filter((i) => itemIds.has(i.id)),
      settings,
      bankName: db.ledgers.find((l) => l.id === settings.bankLedgerId)?.name,
      ledgerName: db.ledgers.find((l) => l.id === voucher.ledgerId)?.name,
      against: against
        ? { number: against.number, date: against.date }
        : undefined,
      allocatedTo: (voucher.allocations ?? []).map((a) => ({
        number:
          db.vouchers.find((v) => v.id === a.voucherId)?.number ??
          "Opening balance",
        amount: a.amount,
      })),
    });
    return clone({
      ...printable,
      shareText: voucherShareText({
        firm: db.firm,
        voucher,
        partyName: party?.name,
        title: printable.title,
      }),
      phone: party?.phone.replace(/\D/g, "") || undefined,
    });
  },

  /** WhatsApp payment reminder for a customer. Real API: http.get(`/parties/${partyId}/reminder`) */
  async reminder(
    partyId: string,
  ): Promise<{ text: string; phone?: string; balance: number }> {
    await delay();
    const db = getDb();
    const party = db.parties.find((p) => p.id === partyId);
    if (!party) throw new Error("Party not found");
    const balance = partyBalance(party, db.vouchers);
    if (party.type !== "customer" || balance <= 0)
      throw new Error("No customer payment is pending.");
    const bills = openBills(collectionBills(party, db.vouchers, today()));
    return clone({
      text: reminderText({
        firm: db.firm,
        partyName: party.name,
        balance,
        openBills: bills,
        upiId: db.invoiceSettings.bankAccount?.upiId,
      }),
      phone: party.phone.replace(/\D/g, "") || undefined,
      balance,
    });
  },
};
