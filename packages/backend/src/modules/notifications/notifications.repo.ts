import type { Item, MockDb, Party, Voucher } from "@repo/core";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Db } from "../../db/client";
import { hydrateVouchers } from "../vouchers/snapshot";

const {
  organization,
  firmProfile,
  parties,
  items,
  vouchers,
  reminderSettings,
  remindersSent,
  noticeReads,
} = schema;

export interface NoticeBooks {
  firm: MockDb["firm"];
  parties: Party[];
  items: Item[];
  vouchers: Voucher[];
  reminders: MockDb["reminders"];
  remindedOn: Record<string, string>;
}

const undef = <T>(value: T | null | undefined): T | undefined =>
  value ?? undefined;

export const notificationsRepo = {
  async books(db: Db, firmId: string): Promise<NoticeBooks> {
    const [firmRow] = await db
      .select({ name: organization.name, profile: firmProfile })
      .from(organization)
      .innerJoin(firmProfile, eq(firmProfile.firmId, organization.id))
      .where(eq(organization.id, firmId));
    if (!firmRow) throw new Error("Firm not found");

    const [settings] = await db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.firmId, firmId));

    // Scheduled scans share one transaction connection, so read each collection in order.
    const partyRows = await db
      .select()
      .from(parties)
      .where(and(eq(parties.firmId, firmId), isNull(parties.deletedAt)));
    const itemRows = await db
      .select()
      .from(items)
      .where(and(eq(items.firmId, firmId), isNull(items.deletedAt)));
    const voucherRows = await db
      .select()
      .from(vouchers)
      .where(eq(vouchers.firmId, firmId));
    const remindedRows = await db
      .select()
      .from(remindersSent)
      .where(eq(remindersSent.firmId, firmId));

    const p = firmRow.profile;
    return {
      firm: {
        id: firmId,
        name: firmRow.name,
        city: p.city,
        state: p.state,
        stateCode: p.stateCode,
        gstin: p.gstin,
        gstRegistration: p.gstRegistration,
        compositionType: undef(p.compositionType),
        fyStart: p.fyStart,
        address: undef(p.address),
        phone: undef(p.phone),
        email: undef(p.email),
        pan: undef(p.pan),
      },
      parties: partyRows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        phone: row.phone,
        city: row.city,
        stateCode: row.stateCode,
        gstin: undef(row.gstin),
        creditDays: row.creditDays,
        creditLimit: row.creditLimit,
        openingBalance: row.openingBalance,
        openingDate: row.openingDate,
      })),
      items: itemRows.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        hsn: row.hsn,
        group: row.groupName,
        taxType: row.taxType,
        gstRate: row.gstRate as 0 | 5 | 18 | 40,
        unit: row.unit,
        altUnit:
          row.altUnitName && row.altUnitFactor
            ? { name: row.altUnitName, factor: row.altUnitFactor }
            : undefined,
        purchasePrice: row.purchasePrice,
        salePrice: row.salePrice,
        mrp: row.mrp,
        reorderLevel: row.reorderLevel ?? 0,
        openingStock: row.openingStock ?? 0,
        batch:
          row.batchNumber && row.batchExpiry
            ? { number: row.batchNumber, expiry: row.batchExpiry }
            : undefined,
      })),
      vouchers: await hydrateVouchers(db, voucherRows),
      reminders: settings
        ? {
            enabled: settings.enabled,
            daysBefore: settings.daysBefore,
            onDueDate: settings.onDueDate,
            repeatEvery: settings.repeatEvery,
            minAmount: settings.minAmount,
          }
        : {
            enabled: true,
            daysBefore: 3,
            onDueDate: true,
            repeatEvery: 7,
            minAmount: 0,
          },
      remindedOn: Object.fromEntries(
        remindedRows.map((row) => [row.partyId, row.sentOn]),
      ),
    };
  },

  async readKeys(db: Db, firmId: string, userId: string) {
    const rows = await db
      .select({ noticeKey: noticeReads.noticeKey })
      .from(noticeReads)
      .where(
        and(eq(noticeReads.firmId, firmId), eq(noticeReads.userId, userId)),
      );
    return new Set(rows.map((row) => row.noticeKey));
  },

  async markRead(db: Db, firmId: string, userId: string, ids: string[]) {
    if (!ids.length) return;
    await db
      .insert(noticeReads)
      .values(
        ids.map((noticeKey) => ({
          firmId,
          userId,
          noticeKey,
        })),
      )
      .onConflictDoNothing();
  },
};
