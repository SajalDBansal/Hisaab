import { voucherHtml, voucherShareText } from "@repo/core";
import { billAllocations } from "@repo/core/src/accounting/settlements";
import type { PrintableVoucher } from "@repo/contracts";
import type { Db } from "../../db/client";
import { notFound } from "../masters/shared";
import { loadReportSnapshot } from "../reports/books";

// HTTP previews and background PDFs use the same committed accounting snapshot.
export async function printVoucher(
  db: Db,
  firmId: string,
  id: string,
  template?: "classic" | "modern" | "compact",
): Promise<PrintableVoucher> {
  const books = await loadReportSnapshot(db, firmId);
  const voucher = books.vouchers.find((v) => v.id === id);
  if (!voucher) throw notFound("entry");
  const party = books.parties.find((p) => p.id === voucher.partyId);
  const settings = {
    ...books.invoiceSettings,
    ...(template ? { template } : {}),
  };
  const itemIds = new Set((voucher.lines ?? []).map((line) => line.itemId));
  const against = books.vouchers.find((v) => v.id === voucher.againstId);
  const printable = voucherHtml({
    firm: books.firm,
    voucher,
    party,
    items: books.items.filter((item) => itemIds.has(item.id)),
    settings,
    bankName: books.ledgers.find((l) => l.id === settings.bankLedgerId)?.name,
    ledgerName: books.ledgers.find((l) => l.id === voucher.ledgerId)?.name,
    against: against
      ? { number: against.number, date: against.date }
      : undefined,
    allocatedTo: billAllocations(voucher).map((allocation) => ({
      number:
        books.vouchers.find((v) => v.id === allocation.voucherId)?.number ??
        "Opening balance",
      amount: allocation.amount,
    })),
  });
  return {
    ...printable,
    shareText: voucherShareText({
      firm: books.firm,
      voucher,
      partyName: party?.name,
      title: printable.title,
    }),
    phone: party?.phone.replace(/\D/g, "") || undefined,
  };
}
