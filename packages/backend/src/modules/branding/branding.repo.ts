import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { firmBranding } from "../../db/schema/firms";

/** The firm's logo and signature (doc 37, T16); nulls and version 0 when never set. */
export async function loadBranding(db: Pick<Db, "select">, firmId: string) {
  const [row] = await db
    .select()
    .from(firmBranding)
    .where(eq(firmBranding.firmId, firmId));
  return {
    logo: row?.logo ?? null,
    signature: row?.signature ?? null,
    version: row?.version ?? 0,
  };
}
