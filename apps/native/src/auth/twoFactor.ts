import qrcode from "qrcode-generator";

// Two-factor sign-in helpers (doc 37, T58).

/** Recovery codes are stored as "abcde-12345"; people may type them without the dash. */
export function recoveryCodeForm(code: string) {
  const plain = code.trim();
  return /^[A-Za-z0-9]{10}$/.test(plain)
    ? `${plain.slice(0, 5)}-${plain.slice(5)}`
    : plain;
}

/** The secret inside an otpauth:// link, in groups of four for typing by hand. */
export function totpSecret(uri: string) {
  const match = /[?&]secret=([A-Z2-7]+)/i.exec(uri);
  return (match?.[1] ?? "").replace(/(.{4})/g, "$1 ").trim();
}

/** QR code squares for a text, as one SVG path (one unit per square, no margin). */
export function qrPath(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++)
      if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  return { size, d };
}
