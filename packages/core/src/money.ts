/**
 * Money helpers. All amounts are integer paise (see types.ts).
 * These functions never use floating-point maths on stored amounts.
 */
import type { Paise } from "./types";

/** Convert a rupee value typed by a person (e.g. "1,250.5") to paise. Returns null if invalid. */
export function parseRupees(input: string): Paise | null {
  const cleaned = input.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Convert whole rupees to paise. Only for seeding mock data: rupees(1250) → 125000. */
export function rupees(value: number): Paise {
  return Math.round(value * 100);
}

/**
 * Round a × b / divisor half away from zero, using whole numbers only.
 * `a`, `b` and `divisor` must be integers; BigInt keeps large products exact.
 */
export function mulDivRound(a: number, b: number, divisor: number): number {
  const product = BigInt(a) * BigInt(b);
  const d = BigInt(divisor);
  const negative = product < 0n !== d < 0n;
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const rounded = (abs(product) * 2n + abs(d)) / (abs(d) * 2n);
  return Number(negative ? -rounded : rounded);
}

/** A quantity or percentage with at most 3 decimals, as a whole number of thousandths. */
export const thousandths = (n: number) => Math.round(n * 1000);

/** Group digits the Indian way: 1234567 → "12,34,567". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

/**
 * Format paise as Indian rupees.
 * formatINR(12345600) → "₹1,23,456.00"
 * formatINR(-5000)    → "−₹50.00"
 * Pass `{ decimals: false }` for compact labels: "₹1,23,456".
 */
export function formatINR(
  paise: Paise,
  options: { decimals?: boolean } = {},
): string {
  const { decimals = true } = options;
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  const text = `₹${groupIndian(String(whole))}${decimals ? `.${fraction}` : ""}`;
  return negative ? `−${text}` : text;
}

/** Value without the ₹ sign, for tables: "1,23,456.00". */
export function formatAmount(paise: Paise): string {
  return formatINR(paise).replace("₹", "");
}

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering: thousand, lakh, crore)
// ---------------------------------------------------------------------------

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t}-${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 1_00_00_000);
  const lakh = Math.floor((n % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((n % 1_00_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${numberToWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** amountInWords(1260800) → "Rupees Twelve Thousand Six Hundred Eight Only" */
export function amountInWords(paise: Paise): string {
  const abs = Math.abs(Math.round(paise));
  const rupeesPart = Math.floor(abs / 100);
  const paisePart = abs % 100;
  let text = `Rupees ${numberToWords(rupeesPart)}`;
  if (paisePart) text += ` and ${twoDigits(paisePart)} Paise`;
  return `${text} Only`;
}
