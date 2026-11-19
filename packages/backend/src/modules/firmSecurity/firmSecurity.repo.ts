import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { firmSecurity } from "../../db/schema/firms";

/** The firm's security settings (doc 37, T58); nothing required and version 0 when never set. */
export async function loadFirmSecurity(db: Pick<Db, "select">, firmId: string) {
  const [row] = await db
    .select()
    .from(firmSecurity)
    .where(eq(firmSecurity.firmId, firmId));
  return {
    requireTwoFactor: row?.requireTwoFactor ?? false,
    version: row?.version ?? 0,
  };
}
