/** Quantities and percentages must survive PostgreSQL's three-decimal storage unchanged. */
export function hasStoredPrecision(value: number): boolean {
  return Number.isFinite(value) && Number(value.toFixed(3)) === value;
}

export const MAX_QUANTITY = 99_999_999_999.999;

export function isStoredQuantity(value: number): boolean {
  return hasStoredPrecision(value) && Math.abs(value) <= MAX_QUANTITY;
}
