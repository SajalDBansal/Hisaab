import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { AppError } from "./app-error";

// Check old and new voucher dates while the caller holds the firm's write lock.
export async function assertOpenPeriod(
  db: Pick<Db, "select">,
  firmId: string,
  dates: string[],
) {
  const [control] = await db
    .select()
    .from(schema.bookControls)
    .where(eq(schema.bookControls.firmId, firmId));
  const closedThrough = control?.closedThrough;
  if (closedThrough && dates.some((date) => date <= closedThrough))
    throw new AppError(
      "PERIOD_CLOSED",
      `Books are closed through ${control.closedThrough}. Ask the owner to reopen the period.`,
      409,
    );
}
