/**
 * Catalogue masters (doc 37, Phase 2): salespersons (T10).
 * Pure rules shared by the API and the in-app demo.
 */
import type { ID } from "./types";

// ---------------------------------------------------------------------------
// Salespersons (T10)
// ---------------------------------------------------------------------------

/**
 * A person who sells for the firm. May be linked to one login of the firm
 * (`userId`); a linked member's sales forms start with them, and roles limited
 * to their own records also see the entries where they are the salesperson.
 */
export interface Salesperson {
  id: ID;
  name: string;
  /** The firm member (login) this salesperson is; at most one salesperson per member. */
  userId?: ID;
  phone?: string;
  /** Switched-off salespersons stay on old entries but can't be picked again. */
  active: boolean;
  version?: number;
}

export interface SalespersonInput {
  name: string;
  userId?: ID | null;
  phone?: string;
  active: boolean;
}

/** Voucher types that carry a salesperson. */
export const SALESPERSON_TYPES = [
  "sale",
  "estimate",
  "proforma",
  "sales-order",
  "delivery-note",
] as const;

export const carriesSalesperson = (type: string) =>
  (SALESPERSON_TYPES as readonly string[]).includes(type);

/** Field problems for a salesperson form; empty when it can be saved. */
export function checkSalesperson(
  input: SalespersonInput,
  others: Salesperson[],
  id?: ID,
): Record<string, string> {
  const problems: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) problems.name = "Enter the salesperson's name.";
  else if (name.length > 80) problems.name = "Use up to 80 characters.";
  else if (
    others.some(
      (s) => s.id !== id && s.name.trim().toLowerCase() === name.toLowerCase(),
    )
  )
    problems.name = "A salesperson with this name already exists.";
  if (input.phone && !/^\+?[\d\s-]{0,20}$/.test(input.phone.trim()))
    problems.phone = "Enter a phone number.";
  if (
    input.userId &&
    others.some((s) => s.id !== id && s.userId === input.userId)
  )
    problems.userId = "This member is already linked to another salesperson.";
  return problems;
}

/** The active salesperson linked to this login, if any (the form's default). */
export function salespersonOfUser(
  list: Salesperson[] | undefined,
  userId: ID | undefined,
): Salesperson | undefined {
  if (!userId) return undefined;
  return list?.find((s) => s.active && s.userId === userId);
}

/**
 * The salesperson a voucher saves. `undefined` keeps the current one (older
 * apps send none), `null` clears it. A new pick must be an active salesperson
 * of the firm; an edit may keep one that was switched off since.
 */
export function savedSalesperson(
  list: Salesperson[] | undefined,
  type: string,
  requested: ID | null | undefined,
  current?: ID,
): ID | undefined {
  if (!carriesSalesperson(type)) {
    if (requested) throw new Error("Only sales entries carry a salesperson.");
    return undefined;
  }
  if (requested === undefined) return current;
  if (requested === null) return undefined;
  if (requested === current) return current;
  // Books without the list loaded (older replicas) leave the check to the server.
  if (!list) return requested;
  const found = list.find((s) => s.id === requested);
  if (!found || !found.active)
    throw new Error("Pick a salesperson from the list.");
  return requested;
}

/** Ids of the salespersons linked to this login (for "own records only"). */
export function salespersonIdsOf(
  list: Salesperson[] | undefined,
  userId: ID,
): ID[] {
  return (list ?? []).filter((s) => s.userId === userId).map((s) => s.id);
}

/**
 * "Own records only" (doc 37, T57 with T10): an entry belongs to a member who
 * made it or who is its salesperson.
 */
export function isOwnRecord(
  voucher: { createdBy?: ID; salespersonId?: ID },
  userId: ID,
  salespersonIds: ID[],
): boolean {
  return (
    voucher.createdBy === userId ||
    (!!voucher.salespersonId && salespersonIds.includes(voucher.salespersonId))
  );
}
