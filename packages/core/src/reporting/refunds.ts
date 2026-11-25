/** Refund history (doc 37, T05): money paid back to customers and received back from suppliers. */
import { describeAccount } from "../accounting/accounts";
import { isPosted } from "../accounting/bills";
import { refundType } from "../accounting/refunds";
import { formatDate } from "../dates";
import type { Voucher } from "../types";
import {
  appendTotals,
  moneyColumn,
  narrationCells,
  reportRow,
  textColumn,
  voucherParty,
  withNarration,
} from "./helpers";
import type { ReportBooks, ReportRequest, ReportSection } from "./types";
import { REPORTS } from "./types";

const SETTLEMENT_REFUNDS = ["customer-refund", "supplier-refund"];

export function refundsSection(
  books: ReportBooks,
  request: ReportRequest,
): ReportSection {
  const byId = new Map(books.vouchers.map((v) => [v.id, v]));
  /** +1 a refund, -1 the reversal of a settlement refund, 0 anything else. */
  const sign = (v: Voucher) => {
    if (v.settlementKind && SETTLEMENT_REFUNDS.includes(v.settlementKind))
      return 1;
    if (v.settlementKind === "reversal") {
      const source = byId.get(v.settlementSourceVoucherId ?? "");
      return source?.settlementKind &&
        SETTLEMENT_REFUNDS.includes(source.settlementKind)
        ? -1
        : 0;
    }
    if (v.settlementKind) return 0;
    const party = books.parties.find((p) => p.id === v.partyId);
    return party && v.type === refundType(party) ? 1 : 0;
  };
  const cashBank = (v: Voucher) => {
    if (v.ledgerId)
      return books.ledgers.find((l) => l.id === v.ledgerId)?.name ?? "";
    const line = v.journalLines?.find(
      (l) => l.account.startsWith("ledger:") || l.account === "cash",
    );
    return line ? describeAccount(line.account, books).name : "";
  };
  const rows = books.vouchers
    .filter(
      (v) =>
        isPosted(v) &&
        v.date >= request.from &&
        v.date <= request.to &&
        (!request.partyId || v.partyId === request.partyId) &&
        sign(v) !== 0,
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .map((v) => {
      const party = books.parties.find((p) => p.id === v.partyId);
      const s = sign(v);
      return reportRow(
        ...narrationCells(
          [
            formatDate(v.date),
            v.number,
            voucherParty(books, v)?.name ?? "",
            `${party?.type === "supplier" ? "From supplier" : "To customer"}${s < 0 ? " (reversed)" : ""}`,
            cashBank(v),
            v.mode ?? "",
            s * v.amount,
          ],
          v,
          request,
        ),
      );
    });
  return appendTotals({
    title: REPORTS[request.report].title,
    columns: withNarration(
      [
        textColumn("Date"),
        textColumn("Voucher"),
        textColumn("Party"),
        textColumn("Refund"),
        textColumn("Cash / bank"),
        textColumn("Mode"),
        moneyColumn("Amount"),
      ],
      request,
    ),
    rows,
  });
}
