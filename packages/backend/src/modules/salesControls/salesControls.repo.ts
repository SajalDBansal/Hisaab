import { eq } from "drizzle-orm";
import {
  DEFAULT_CHALLAN_STOCK,
  DEFAULT_OVERDUE_SALES_POLICY,
  DEFAULT_STOCK_POLICY,
} from "@repo/core";
import type { Db } from "../../db/client";
import { salesControls } from "../../db/schema/firms";

/** The firm's credit control (doc 37, T11); the default and version 0 when never set. */
export async function loadSalesControls(
  db: Pick<Db, "select">,
  firmId: string,
) {
  const [row] = await db
    .select()
    .from(salesControls)
    .where(eq(salesControls.firmId, firmId));
  return {
    overdueSales: row?.overdueSales ?? DEFAULT_OVERDUE_SALES_POLICY,
    stockPolicy: row?.stockPolicy ?? DEFAULT_STOCK_POLICY,
    challanStock: row?.challanStock ?? DEFAULT_CHALLAN_STOCK,
    version: row?.version ?? 0,
  };
}
