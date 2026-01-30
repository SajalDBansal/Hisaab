import type { ItemInput, ItemRow } from "@repo/contracts";
import { checkItem, cleanItem, gstModeOf, type Item } from "@repo/core";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { itemsRepo, type ItemDb, type ItemRecord } from "./items.repo";
import { unitsRepo } from "./units.repo";
import {
  editedElsewhere,
  invalidFields,
  isUniqueViolation,
  notFound,
} from "@repo/backend/modules/masters/shared";

type GstRate = ItemRow["gstRate"];

export const toItemRow = (r: ItemRecord): ItemRow => {
  const stock = Number(r.stock);
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    hsn: r.hsn,
    group: r.groupName,
    taxType: r.taxType,
    gstRate: r.gstRate as GstRate,
    unit: r.unit,
    ...(r.altUnitName && r.altUnitFactor
      ? { altUnit: { name: r.altUnitName, factor: r.altUnitFactor } }
      : {}),
    purchasePrice: r.purchasePrice,
    salePrice: r.salePrice,
    mrp: r.mrp,
    reorderLevel: r.reorderLevel,
    openingStock: r.openingStock,
    openingCost: r.openingCost ?? undefined,
    openingBookScope: r.openingBookScope ?? undefined,
    openingLots: r.openingLots ?? undefined,
    ...(r.batchNumber && r.batchExpiry
      ? { batch: { number: r.batchNumber, expiry: r.batchExpiry } }
      : {}),
    version: r.version,
    stock,
    lowStock: stock < r.reorderLevel,
  };
};

const columnsOf = (i: ItemInput) => ({
  name: i.name,
  code: i.code,
  hsn: i.hsn,
  groupName: i.group,
  taxType: i.taxType,
  gstRate: i.gstRate,
  unit: i.unit,
  altUnitName: i.altUnit?.name ?? null,
  altUnitFactor: i.altUnit?.factor ?? null,
  purchasePrice: i.purchasePrice,
  salePrice: i.salePrice,
  mrp: i.mrp,
  reorderLevel: i.reorderLevel,
  openingStock: i.openingStock,
  openingLots: i.openingLots,
  batchNumber: i.batch?.number ?? null,
  batchExpiry: i.batch?.expiry ?? null,
});

const asCoreItem = (r: ItemRecord): Item => ({
  ...toItemRow(r),
});

/** The same checks the app form runs (for this firm's GST mode), plus duplicate names and codes. */
async function validated(
  db: ItemDb,
  firmId: string,
  input: ItemInput,
  current?: ItemRecord,
) {
  const item = cleanItem(input);
  const [profile] = await db
    .select({ gstRegistration: schema.firmProfile.gstRegistration })
    .from(schema.firmProfile)
    .where(eq(schema.firmProfile.firmId, firmId));
  const mode = gstModeOf({
    gstRegistration: profile?.gstRegistration ?? "regular",
  });
  const others = await itemsRepo.clashes(db, firmId, item, current?.id);
  const problems: Record<string, string | undefined> = {
    ...checkItem(
      item,
      others.map((o) => asCoreItem({ ...o, stock: "0" })),
      current?.id,
      mode,
    ),
  };

  // Units must be in the firm's list and switched on (an item may keep one that was switched off later)
  const units = await unitsRepo.list(db, firmId);
  const usable = (name: string, was?: string | null) =>
    units.some((u) => u.name === name && (u.enabled || name === was));
  if (!problems.unit && !usable(item.unit, current?.unit))
    problems.unit = `${item.unit} isn't a switched-on unit. Add it in Settings → Units.`;
  if (
    !problems.altUnit &&
    item.altUnit &&
    !usable(item.altUnit.name, current?.altUnitName)
  )
    problems.altUnit = `${item.altUnit.name} isn't a switched-on unit. Add it in Settings → Units.`;

  const error = invalidFields(problems);
  if (error) throw error;
  return item;
}

const duplicate = () =>
  new AppError(
    "DUPLICATE",
    "An item with this name or code already exists.",
    409,
  );

export const itemsService = {
  async create(db: Db, firmId: string, input: ItemInput) {
    return withFirmWrite(db, firmId, async (tx) => {
      const item = await validated(tx, firmId, input);
      const id = uuidv7();
      try {
        const [profile] = await tx
          .select()
          .from(schema.firmProfile)
          .where(eq(schema.firmProfile.firmId, firmId));
        await itemsRepo.insert(tx, {
          id,
          firmId,
          ...columnsOf(item),
          openingCost: item.openingCost ?? item.purchasePrice,
          openingBookScope:
            item.openingBookScope ??
            (profile?.gstRegistration === "unregistered" ||
            item.taxType === "nongst"
              ? "nongst"
              : "gst"),
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate();
        throw err;
      }
      const row = await itemsRepo.get(tx, firmId, id);
      if (!row) throw notFound("item");
      return toItemRow(row);
    });
  },

  async update(
    db: Db,
    firmId: string,
    id: string,
    version: number,
    input: ItemInput,
  ) {
    // Share the voucher lock so opening stock cannot change during a sale.
    return db.transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
      );
      const current = await itemsRepo.get(db, firmId, id);
      if (!current) throw notFound("item");
      const item = await validated(db, firmId, input, current);
      if (
        item.openingStock !== current.openingStock ||
        (item.openingLots !== undefined && JSON.stringify(item.openingLots) !== JSON.stringify(current.openingLots ?? [])) ||
        (item.openingCost !== undefined &&
          item.openingCost !== current.openingCost) ||
        (item.openingBookScope !== undefined &&
          item.openingBookScope !== current.openingBookScope)
      ) {
        if (await itemsRepo.hasEntries(db, firmId, id))
          throw new AppError(
            "ITEM_IN_USE",
            "Opening stock is already in use and cannot be changed.",
            409,
          );
      }
      // Stock is kept in the base unit, so it can't change under existing entries
      if (
        (item.unit !== current.unit ||
          item.altUnit?.factor !== (current.altUnitFactor ?? undefined)) &&
        (await itemsRepo.hasEntries(db, firmId, id))
      )
        throw new AppError(
          "ITEM_IN_USE",
          "This item already has entries, so its units can't be changed.",
          409,
        );
      let saved: boolean;
      try {
        saved = await itemsRepo.update(db, firmId, id, version, {
          ...columnsOf(item),
          openingCost:
            item.openingCost ?? current.openingCost ?? current.purchasePrice,
          openingBookScope: item.openingBookScope ?? current.openingBookScope,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicate();
        throw err;
      }
      if (!saved) throw editedElsewhere("item");
      const row = await itemsRepo.get(db, firmId, id);
      if (!row) throw notFound("item");
      return toItemRow(row);
    });
  },

  async remove(db: Db, firmId: string, id: string, version: number) {
    return db.transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
      );
      if (!(await itemsRepo.get(db, firmId, id))) throw notFound("item");
      if (await itemsRepo.hasEntries(db, firmId, id))
        throw new AppError(
          "ITEM_IN_USE",
          "This item has entries, so it can't be deleted.",
          409,
        );
      if (
        !(await itemsRepo.update(db, firmId, id, version, {
          deletedAt: new Date(),
        }))
      )
        throw editedElsewhere("item");
    });
  },
};
