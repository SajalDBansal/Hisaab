import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { gstModeOf, today } from "@repo/core";
import { v7 as uuidv7 } from "uuid";
import type {
  ImportApplyResult,
  MasterImportKind,
} from "@repo/contracts/src/imports";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { masterImportBatches } from "@repo/backend/modules/imports/imports.schema";
import type { CsvRead } from "./imports.csv";
import type { ImportContext, PreparedRow } from "./imports.validation";

export type ImportTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function requireImportRole(role: string | undefined, financial = false) {
  if (financial && role !== "owner")
    throw new AppError(
      "FORBIDDEN",
      "Only the firm owner can import financial openings.",
      403,
    );
  if (role !== "owner" && role !== "accountant")
    throw new AppError(
      "FORBIDDEN",
      "Only the firm owner or accountant can import masters.",
      403,
    );
}

export async function authorizeImport(
  tx: ImportTx,
  firmId: string,
  userId: string,
  financial = false,
) {
  const [member] = await tx
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, firmId),
        eq(schema.member.userId, userId),
      ),
    )
    .for("share");
  requireImportRole(member?.role, financial);
}

export async function importContext(
  tx: ImportTx,
  firmId: string,
  kind: MasterImportKind,
  csv: CsvRead,
): Promise<ImportContext> {
  const [profile] = await tx
    .select({ gstRegistration: schema.firmProfile.gstRegistration })
    .from(schema.firmProfile)
    .where(eq(schema.firmProfile.firmId, firmId))
    .for("share");
  if (!profile)
    throw new AppError("NOT_FOUND", "The firm profile was not found.", 404);
  const context: ImportContext = {
    gstMode: gstModeOf(profile),
    parties: [],
    items: [],
    units: [],
  };
  const header = csv.records[0] ?? [];
  const values = (column: string, fold = false) => {
    const index = header.indexOf(column);
    return [
      ...new Set(
        csv.records
          .slice(1)
          .map((r) => r[index] ?? "")
          .map((v) => (fold ? v.trim().toLowerCase() : v))
          .filter(Boolean),
      ),
    ];
  };
  const names = values("name", true);
  if (kind === "items") {
    const codes = values("code", true);
    context.items = await tx
      .select({ name: schema.items.name, code: schema.items.code })
      .from(schema.items)
      .where(
        and(
          eq(schema.items.firmId, firmId),
          isNull(schema.items.deletedAt),
          or(
            inArray(sql`lower(btrim(${schema.items.name}))`, names),
            inArray(sql`lower(btrim(${schema.items.code}))`, codes),
          ),
        ),
      )
      .limit(5001);
    context.units = await tx
      .select({ name: schema.units.name, enabled: schema.units.enabled })
      .from(schema.units)
      .where(
        and(
          eq(schema.units.firmId, firmId),
          inArray(
            schema.units.name,
            values("unit").map((v) => v.trim()),
          ),
        ),
      )
      .for("share");
  } else {
    context.parties = await tx
      .select({
        name: schema.parties.name,
        gstin: schema.parties.gstin,
        type: schema.parties.type,
      })
      .from(schema.parties)
      .where(
        and(
          eq(schema.parties.firmId, firmId),
          isNull(schema.parties.deletedAt),
          or(
            inArray(sql`lower(btrim(${schema.parties.name}))`, names),
            inArray(schema.parties.gstin, values("gstin")),
          ),
        ),
      )
      .limit(5001);
  }
  if (context.items.length > 5000 || context.parties.length > 5000)
    throw new AppError(
      "IMPORT_MATCH_LIMIT",
      "Too many existing records match this CSV. Import a smaller file.",
      422,
    );
  return context;
}

export async function importReceipt(
  tx: ImportTx,
  userId: string,
  requestKey: string,
  batchId: string,
) {
  const rows = await tx
    .select()
    .from(masterImportBatches)
    .where(
      or(
        eq(masterImportBatches.id, batchId),
        and(
          eq(masterImportBatches.userId, userId),
          eq(masterImportBatches.requestKey, requestKey),
        ),
      ),
    );
  return rows;
}

export async function insertImportedMasters(
  tx: ImportTx,
  firmId: string,
  prepared: PreparedRow[],
  context: ImportContext,
) {
  const ids: string[] = [];
  const parties: (typeof schema.parties.$inferInsert)[] = [];
  const items: (typeof schema.items.$inferInsert)[] = [];
  for (const row of prepared) {
    const id = uuidv7();
    ids.push(id);
    if (row.entity === "party") {
      parties.push({
        ...row.input,
        id,
        firmId,
        gstin: row.input.gstin || null,
        openingBalance: 0,
        openingDate: today(),
      });
    } else {
      const i = row.input;
      items.push({
        id,
        firmId,
        name: i.name,
        code: i.code,
        hsn: i.hsn,
        groupName: i.group,
        taxType: i.taxType,
        gstRate: i.gstRate,
        unit: i.unit,
        purchasePrice: i.purchasePrice,
        salePrice: i.salePrice,
        mrp: i.mrp,
        reorderLevel: i.reorderLevel,
        openingStock: 0,
        openingCost: i.purchasePrice,
        openingBookScope:
          context.gstMode === "off" || i.taxType === "nongst"
            ? "nongst"
            : "gst",
      });
    }
  }
  // No conflict-ignore or update path: any failed insert rolls back the entire transaction.
  if (parties.length) await tx.insert(schema.parties).values(parties);
  if (items.length) await tx.insert(schema.items).values(items);
  return ids;
}

export async function saveImportReceipt(
  tx: ImportTx,
  receipt: {
    firmId: string;
    userId: string;
    requestKey: string;
    fileHash: string;
    result: ImportApplyResult;
  },
) {
  await tx.insert(masterImportBatches).values({
    id: receipt.result.batchId,
    firmId: receipt.firmId,
    userId: receipt.userId,
    requestKey: receipt.requestKey,
    fileHash: receipt.fileHash,
    kind: receipt.result.kind,
    result: receipt.result,
    appliedAt: new Date(receipt.result.appliedAt),
  });
}
