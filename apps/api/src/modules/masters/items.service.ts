import type { ItemInput, ItemRow } from "@repo/contracts";
import {
  canSeeCosts,
  checkItem,
  cleanItem,
  gstModeOf,
  storedCustomValues,
  type CustomFieldValues,
  type Item,
  type Role,
  type VariantAttribute,
  checkVariantAttributes,
  cleanVariantAttributes,
  missingVariants,
  variantItem,
} from "@repo/core";
import { loadCustomFieldDefs } from "@repo/backend/modules/customFields/customFields.repo";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { schema, type Db } from "@repo/backend/db/client";
import { AppError } from "@repo/backend/lib/app-error";
import { withFirmWrite } from "@repo/backend/lib/firm-write";
import { itemsRepo, type ItemDb, type ItemRecord } from "./items.repo";
import {
  itemExtraColumns,
  itemExtras,
} from "@repo/backend/modules/items/itemExtras";
import { unitsRepo } from "./units.repo";
import {
  editedElsewhere,
  invalidFields,
  isUniqueViolation,
  notFound,
} from "@repo/backend/modules/masters/shared";

type GstRate = ItemRow["gstRate"];

/**
 * A role that can't see purchase costs (sales staff) can't set or change them
 * either: an edit keeps the item's costs and opening stock, and a new item starts
 * without a purchase price or opening stock for the owner or accountant to add.
 */
function costsForRole(
  role: Role,
  input: ItemInput,
  current?: ItemRecord,
): ItemInput {
  if (canSeeCosts(role)) return input;
  if (!current) {
    if (input.openingStock || input.openingLots?.length)
      throw new AppError(
        "FORBIDDEN",
        "Opening stock and its cost are entered by the owner or accountant.",
        403,
      );
    return {
      ...input,
      purchasePrice: 0,
      openingCost: undefined,
      openingLots: undefined,
    };
  }
  return {
    ...input,
    purchasePrice: current.purchasePrice,
    openingStock: current.openingStock,
    openingCost: current.openingCost ?? undefined,
    openingLots: current.openingLots ?? undefined,
    openingBookScope: current.openingBookScope ?? undefined,
  };
}

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
    ...(r.customFields ? { customFields: r.customFields } : {}),
    ...itemExtras(r),
    version: r.version,
    stock,
    lowStock: r.kind !== "service" && stock < r.reorderLevel,
    overStock: r.kind !== "service" && !!r.maxStock && stock > r.maxStock,
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
  ...itemExtraColumns(i),
});

/** undefined leaves stored values alone on update; null clears them. */
const customColumn = (value: CustomFieldValues | null | undefined) =>
  value === undefined ? {} : { customFields: value };

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

  // Custom values: checked against the firm's item fields (doc 37, T07).
  // Not sent (older app) = keep what is stored.
  let customFields: CustomFieldValues | null | undefined;
  if (item.customFields !== undefined)
    try {
      customFields =
        storedCustomValues(
          await loadCustomFieldDefs(db, firmId),
          "item",
          item.customFields,
        ) ?? null;
    } catch (e) {
      problems.customFields = (e as Error).message;
    }

  const error = invalidFields(problems);
  if (error) throw error;
  return { ...item, storedCustomFields: customFields };
}

const duplicate = () =>
  new AppError(
    "DUPLICATE",
    "An item with this name or code already exists.",
    409,
  );

export const itemsService = {
  async create(db: Db, firmId: string, input: ItemInput, role: Role) {
    return withFirmWrite(db, firmId, async (tx) => {
      const item = await validated(tx, firmId, costsForRole(role, input));
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
          ...customColumn(item.storedCustomFields),
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
    role: Role,
  ) {
    // Share the voucher lock so opening stock cannot change during a sale.
    return db.transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
      );
      const current = await itemsRepo.get(db, firmId, id);
      if (!current) throw notFound("item");
      const item = await validated(
        db,
        firmId,
        costsForRole(role, input, current),
        current,
      );
      if (
        item.openingStock !== current.openingStock ||
        (item.openingLots !== undefined &&
          JSON.stringify(item.openingLots) !==
            JSON.stringify(current.openingLots ?? [])) ||
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
      // Stock lots follow from the kind, so it is fixed once the item is used (doc 37, T39).
      if (
        (item.kind ?? "goods") !== current.kind &&
        (await itemsRepo.hasEntries(db, firmId, id))
      )
        throw new AppError(
          "ITEM_IN_USE",
          "This item already has entries, so it can't change between goods and service.",
          409,
        );
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
          ...customColumn(item.storedCustomFields),
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

  /**
   * Item variants (doc 37, T35): set the parent's attributes and add a variant
   * item for each new combination. An item becomes a parent only before it has
   * stock or entries; attributes then stay and values can only be added.
   */
  async makeVariants(
    db: Db,
    firmId: string,
    id: string,
    version: number,
    attributes: VariantAttribute[],
    role: Role,
  ) {
    return db.transaction(async (db) => {
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${firmId}, 0))`,
      );
      const current = await itemsRepo.get(db, firmId, id);
      if (!current) throw notFound("item");
      if (current.version !== version) throw editedElsewhere("item");
      if (current.parentId)
        throw new AppError(
          "VARIANT_OF_VARIANT",
          "A variant can't have variants of its own.",
          409,
        );
      const clean = cleanVariantAttributes(attributes);
      const problem = checkVariantAttributes(
        clean,
        current.variantAttributes ?? undefined,
      );
      if (problem)
        throw invalidFields({ attributes: problem }) ?? notFound("item");
      if (
        !current.variantAttributes?.length &&
        (current.openingStock > 0 ||
          (await itemsRepo.hasEntries(db, firmId, id)))
      )
        throw new AppError(
          "ITEM_IN_USE",
          "This item already has stock or entries; make a new item for the variants.",
          409,
        );
      const children = await db
        .select({ variantValues: schema.items.variantValues })
        .from(schema.items)
        .where(
          and(
            eq(schema.items.firmId, firmId),
            eq(schema.items.parentId, id),
            isNull(schema.items.deletedAt),
          ),
        );
      const parent = toItemRow(current);
      const createdIds: string[] = [];
      for (const values of missingVariants(
        clean,
        children.map((c) => ({ variantValues: c.variantValues ?? undefined })),
      )) {
        const {
          parentId: _p,
          variantValues: _v,
          ...fields
        } = variantItem(parent, values);
        const item = await validated(db, firmId, costsForRole(role, fields));
        const childId = uuidv7();
        try {
          await itemsRepo.insert(db, {
            id: childId,
            firmId,
            ...columnsOf(item),
            openingCost: item.purchasePrice,
            openingBookScope: current.openingBookScope,
            parentId: id,
            variantValues: values,
          });
        } catch (err) {
          if (isUniqueViolation(err)) throw duplicate();
          throw err;
        }
        createdIds.push(childId);
      }
      if (
        !(await itemsRepo.update(db, firmId, id, version, {
          variantAttributes: clean,
          openingStock: 0,
        }))
      )
        throw editedElsewhere("item");
      const rows = await Promise.all(
        [id, ...createdIds].map((rowId) => itemsRepo.get(db, firmId, rowId)),
      );
      const [saved, ...made] = rows.map((row) => {
        if (!row) throw notFound("item");
        return toItemRow(row);
      });
      if (!saved) throw notFound("item");
      return { parent: saved, created: made };
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
