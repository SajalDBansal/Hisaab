/**
 * UPI payment QR printed on sale bills (doc 37, T18): a UPI deep link with the
 * amount due and the bill number, drawn as an inline SVG so the app's print, the
 * PDF share and the server PDF all carry it without images or network calls.
 */
import qrcode from "qrcode-generator";
import { settledAmounts } from "../accounting/bills";
import type { PaymentMode, Paise, UpiQrSettings, Voucher } from "../types";

/** upi://pay?pa=…&pn=…&am=1234.50&tn=SI/26-27/0001&cu=INR (NPCI deep-link fields). */
export function upiPayLink(
  upi: UpiQrSettings,
  amount: Paise,
  note: string,
): string {
  const rupees = `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
  const field = (key: string, value: string) =>
    `${key}=${encodeURIComponent(value)}`;
  return `upi://pay?${[
    field("pa", upi.upiId),
    field("pn", upi.payeeName),
    `am=${rupees}`,
    field("tn", note),
    "cu=INR",
  ].join("&")}`;
}

/** A QR code as an SVG element (black modules on white, quiet zone included). */
export function qrSvg(text: string, sizePx: number): string {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const margin = 4;
  const total = count + margin * 2;
  let path = "";
  for (let row = 0; row < count; row += 1)
    for (let col = 0; col < count; col += 1)
      if (qr.isDark(row, col))
        path += `M${col + margin} ${row + margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="UPI QR code"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** What a printed bill shows about payment: received so far, still due, and how it was paid. */
export interface BillPayment {
  received: Paise;
  due: Paise;
  modes: PaymentMode[];
}

/** Payment position of a sale from the books (posted receipts, settlements and returns). */
export function billPayment(vouchers: Voucher[], bill: Voucher): BillPayment {
  const received = Math.min(
    settledAmounts(vouchers).get(bill.id) ?? 0,
    bill.amount,
  );
  const modes = [
    ...new Set(
      vouchers
        .filter(
          (v) =>
            v.type === "receipt" &&
            v.status === "posted" &&
            v.mode &&
            (v.allocations ?? []).some((a) => a.voucherId === bill.id),
        )
        .map((v) => v.mode as PaymentMode),
    ),
  ];
  return { received, due: bill.amount - received, modes };
}
