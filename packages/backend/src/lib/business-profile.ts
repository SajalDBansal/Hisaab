import type { FirmStatutory, MsmeType } from "@repo/core";

type StatutoryColumns = {
  [K in keyof FirmStatutory]-?: FirmStatutory[K] | null;
};

/** The firm's optional statutory details (doc 37, T61), leaving out the empty ones. */
export function firmStatutory(p: StatutoryColumns): FirmStatutory {
  const out: Record<string, string> = {};
  for (const key of [
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
  ] as const) {
    const value = p[key];
    if (value) out[key] = value;
  }
  return out as FirmStatutory;
}

/** A supplier's MSME class and Udyam number (doc 37, T30), when it has them. */
/** A party's price list (doc 37, T36), absent when it has none. */
export const partyPricing = (r: { priceListId: string | null }) =>
  r.priceListId ? { priceListId: r.priceListId } : {};

export function partyMsme(r: {
  msmeType: MsmeType | null;
  udyamNumber: string | null;
}): { msmeType?: MsmeType; udyamNumber?: string } {
  return {
    ...(r.msmeType ? { msmeType: r.msmeType } : {}),
    ...(r.msmeType && r.udyamNumber ? { udyamNumber: r.udyamNumber } : {}),
  };
}
