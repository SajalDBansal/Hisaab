/**
 * Ready-to-send text for WhatsApp / SMS: payment reminders and invoice messages.
 * Kept short and polite; amounts in Indian format.
 */
import type { Bill } from "../accounting/bills";
import { formatDate } from "../dates";
import { formatINR } from "../money";
import type { Firm, Paise, Voucher } from "../types";

/** "Namaste Gupta ji, … ₹24,337 pending … SI/26-27/0031 dated … Pay by UPI: …" */
export function reminderText(input: {
  firm: Firm;
  partyName: string;
  balance: Paise;
  openBills: Bill[];
  upiId?: string;
}): string {
  const { firm, partyName, balance, openBills, upiId } = input;
  const bills = openBills
    .slice(0, 5)
    .map(
      (b) =>
        `• ${b.number} dated ${formatDate(b.date)}: ${formatINR(b.pending)}${b.overdueDays > 0 ? ` (${b.overdueDays} days overdue)` : ""}`,
    );
  const more =
    openBills.length > 5 ? [`• and ${openBills.length - 5} more`] : [];
  return [
    `Namaste ${partyName},`,
    ``,
    `A gentle reminder from ${firm.name}: ${formatINR(balance)} is pending on your account.`,
    ...(bills.length ? [``, ...bills, ...more] : []),
    ``,
    upiId
      ? `You can pay by UPI to ${upiId} or by bank transfer.`
      : `You can pay by UPI or bank transfer.`,
    `Thank you!`,
  ].join("\n");
}

/** Message sent along with an invoice PDF. */
export function voucherShareText(input: {
  firm: Firm;
  voucher: Voucher;
  partyName?: string;
  title: string;
}): string {
  const { voucher: v, title } = input;
  const firm = v.snapshot?.firm ?? input.firm;
  const partyName = v.snapshot ? v.snapshot.party?.name : input.partyName;
  const greet = partyName ? `Namaste ${partyName},\n\n` : "";
  const due =
    v.type === "sale" && v.dueDate ? ` Due by ${formatDate(v.dueDate)}.` : "";
  return `${greet}${firm.name}: ${title.toLowerCase()} ${v.number} dated ${formatDate(v.date)} for ${formatINR(v.amount)}.${due}\n\nThank you for your business!`;
}
