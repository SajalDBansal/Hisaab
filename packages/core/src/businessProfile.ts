/**
 * Business profile and MSME details (doc 37, T61 and T30): the firm's optional
 * statutory numbers, and a supplier's MSME class. Checks are shared by the app
 * forms, the demo books and the API.
 */
import type {
  BusinessType,
  FirmStatutory,
  MsmeType,
  OwnershipType,
} from "./types";

export const MSME_TYPES = [
  "micro",
  "small",
  "medium",
] as const satisfies readonly MsmeType[];
export const MSME_LABELS: Record<MsmeType, string> = {
  micro: "Micro",
  small: "Small",
  medium: "Medium",
};

export const OWNERSHIP_TYPES = [
  "proprietorship",
  "partnership",
  "llp",
  "private-limited",
  "public-limited",
  "one-person-company",
  "huf",
  "trust-society",
  "other",
] as const satisfies readonly OwnershipType[];
export const OWNERSHIP_LABELS: Record<OwnershipType, string> = {
  proprietorship: "Proprietorship",
  partnership: "Partnership firm",
  llp: "LLP",
  "private-limited": "Private limited company",
  "public-limited": "Public limited company",
  "one-person-company": "One person company",
  huf: "HUF",
  "trust-society": "Trust or society",
  other: "Other",
};

export const BUSINESS_TYPES = [
  "retail",
  "wholesale",
  "distribution",
  "manufacturing",
  "services",
  "other",
] as const satisfies readonly BusinessType[];
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  retail: "Retail",
  wholesale: "Wholesale",
  distribution: "Distribution",
  manufacturing: "Manufacturing",
  services: "Services",
  other: "Other",
};

/** Company identification number, e.g. U52100UP2015PTC012345. */
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
/** LLP identification number, e.g. AAB-1234. */
export const LLPIN_PATTERN = /^[A-Z]{3}-\d{4}$/;
/** Tax deduction account number, e.g. DELA12345B. */
export const TAN_PATTERN = /^[A-Z]{4}\d{5}[A-Z]$/;
/** Udyam registration number, e.g. UDYAM-UP-09-0012345. */
export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
/** Importer-exporter code: 10 characters (usually the PAN). */
export const IEC_PATTERN = /^[A-Z0-9]{10}$/;
/** FSSAI licence or registration number: 14 digits. */
export const FSSAI_PATTERN = /^\d{14}$/;
const WEBSITE_PATTERN = /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i;

export const STATUTORY_KEYS = [
  "ownershipType",
  "businessType",
  "industry",
  "cin",
  "tan",
  "udyamNumber",
  "msmeType",
  "iec",
  "fssai",
  "drugLicence",
  "website",
] as const satisfies readonly (keyof FirmStatutory)[];

export type StatutoryErrors = Partial<Record<keyof FirmStatutory, string>>;

const upper = (value: string | undefined) =>
  (value ?? "").trim().toUpperCase().replace(/\s+/g, "");

/** Trim and upper-case what the user typed; empty text stays "" (= clear). */
export function cleanStatutory<T extends Partial<Record<string, unknown>>>(
  f: T,
): T {
  const next: Record<string, unknown> = { ...f };
  for (const key of ["cin", "tan", "udyamNumber", "iec", "fssai"] as const)
    if (typeof next[key] === "string") next[key] = upper(next[key] as string);
  for (const key of ["industry", "drugLicence", "website"] as const)
    if (typeof next[key] === "string") next[key] = (next[key] as string).trim();
  return next as T;
}

/** The MSME class and Udyam number, for a firm or a supplier. */
export function checkMsme(f: {
  msmeType?: string;
  udyamNumber?: string;
}): Partial<Record<"msmeType" | "udyamNumber", string>> {
  const errors: Partial<Record<"msmeType" | "udyamNumber", string>> = {};
  const udyam = upper(f.udyamNumber);
  if (f.msmeType && !(MSME_TYPES as readonly string[]).includes(f.msmeType))
    errors.msmeType = "Pick micro, small or medium.";
  if (udyam && !UDYAM_PATTERN.test(udyam))
    errors.udyamNumber = "Udyam number should look like UDYAM-UP-09-0012345.";
  else if (udyam && !f.msmeType)
    errors.udyamNumber = "Pick micro, small or medium for this Udyam number.";
  return errors;
}

/** Firm profile statutory fields. Empty fields are fine; only typed ones are checked. */
export function checkFirmStatutory(f: {
  [K in keyof FirmStatutory]?: string;
}): StatutoryErrors {
  const errors: StatutoryErrors = { ...checkMsme(f) };
  const cin = upper(f.cin);
  if (cin && !CIN_PATTERN.test(cin) && !LLPIN_PATTERN.test(cin))
    errors.cin = "Enter a 21-character CIN, or an LLPIN like AAB-1234.";
  const tan = upper(f.tan);
  if (tan && !TAN_PATTERN.test(tan))
    errors.tan = "TAN should be 10 characters, like DELA12345B.";
  const iec = upper(f.iec);
  if (iec && !IEC_PATTERN.test(iec))
    errors.iec = "IEC should be 10 letters or digits.";
  const fssai = upper(f.fssai);
  if (fssai && !FSSAI_PATTERN.test(fssai))
    errors.fssai = "FSSAI number should be 14 digits.";
  if ((f.industry ?? "").trim().length > 100)
    errors.industry = "Keep it under 100 characters.";
  if ((f.drugLicence ?? "").trim().length > 100)
    errors.drugLicence = "Keep it under 100 characters.";
  const website = (f.website ?? "").trim();
  if (website && (website.length > 100 || !WEBSITE_PATTERN.test(website)))
    errors.website = "Enter a web address like www.example.com.";
  if (
    f.ownershipType &&
    !(OWNERSHIP_TYPES as readonly string[]).includes(f.ownershipType)
  )
    errors.ownershipType = "Pick how the business is owned.";
  if (
    f.businessType &&
    !(BUSINESS_TYPES as readonly string[]).includes(f.businessType)
  )
    errors.businessType = "Pick the type of business.";
  return errors;
}

/** "UDYAM-UP-09-0012345 (Micro)" for prints and screens. */
export function udyamLabel(f: {
  msmeType?: MsmeType;
  udyamNumber?: string;
}): string {
  if (!f.msmeType) return "";
  return f.udyamNumber
    ? `${f.udyamNumber} (${MSME_LABELS[f.msmeType]})`
    : `${MSME_LABELS[f.msmeType]} enterprise`;
}
