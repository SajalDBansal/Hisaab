import { can, type Role } from "@repo/core";
import type { PartyInput } from "@repo/contracts";
import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";

type PartyType = PartyInput["type"];

// Both sides of a type conversion require permission, even if no balances change.
export function requirePartyWrite(role: Role, ...types: PartyType[]) {
  if (
    types.length > 0 &&
    types.every((type) => can(role, type === "supplier" ? "purchase" : "sales"))
  )
    return;
  throw new AppError(
    "FORBIDDEN",
    "Your role can't change this type of party. Ask the owner of the firm.",
    403,
  );
}

// Retry lookup/cancellation must also authorize a saved party, including tombstones.
export async function authorizePartyWrite(
  db: Pick<Db, "select">,
  firmId: string,
  role: Role,
  requestedType?: PartyType,
  id?: string,
) {
  const types: PartyType[] = requestedType ? [requestedType] : [];
  if (id) {
    const [current] = await db
      .select({ type: schema.parties.type })
      .from(schema.parties)
      .where(and(eq(schema.parties.firmId, firmId), eq(schema.parties.id, id)));
    if (current) types.push(current.type);
  }
  // Missing records still require a write role before their normal not-found result.
  requirePartyWrite(role, ...(types.length ? types : ["customer" as const]));
}
