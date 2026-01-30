import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { moment, primaryId, stamps } from "./columns";
import { parties } from "./masters";
import { vouchers } from "./vouchers";

export const documentKind = pgEnum("document_kind", [
  "bill",
  "receipt",
  "certificate",
  "agreement",
  "other",
]);

const firmId = () =>
  uuid("firm_id")
    .notNull()
    .references(() => organization.id, { onDelete: "restrict" });

/** Files kept against the books. The file itself lives in S3; this row points to it. */
export const documents = pgTable(
  "documents",
  {
    id: primaryId(),
    firmId: firmId(),
    name: text("name").notNull(),
    kind: documentKind("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    // Empty until the upload finishes
    s3Key: text("s3_key"),
    thumbnailKey: text("thumbnail_key"),
    contentType: text("content_type"),
    readyAt: moment("ready_at"),
    folder: text("folder").notNull().default(""),
    accountKey: text("account_key"),
    partyId: uuid("party_id").references(() => parties.id, {
      onDelete: "restrict",
    }),
    voucherId: uuid("voucher_id").references(() => vouchers.id, {
      onDelete: "restrict",
    }),
    note: text("note"),
    uploadedOn: date("uploaded_on", { mode: "string" }).notNull(),
    deletedAt: moment("deleted_at"),
    ...stamps,
  },
  (t) => [index("documents_firm_idx").on(t.firmId, t.uploadedOn)],
);

/**
 * Remembers the answer to a create request, so a retry (bad network) returns the
 * same answer instead of creating a second bill. Cleaned up after 7 days.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    // Hash of the request body: the same key with a different body is an error
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    createdAt: moment("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_created_idx").on(t.createdAt),
  ],
);

/** Which notifications each person has seen. */
export const noticeReads = pgTable(
  "notice_reads",
  {
    firmId: firmId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    noticeKey: text("notice_key").notNull(),
    readAt: moment("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.userId, t.noticeKey] })],
);

/** The last day a payment reminder went to each customer. */
export const remindersSent = pgTable(
  "reminders_sent",
  {
    firmId: firmId(),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id, { onDelete: "cascade" }),
    sentOn: date("sent_on", { mode: "string" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.firmId, t.partyId] })],
);

export const syncEntity = pgEnum("sync_entity", [
  "account",
  "party",
  "item",
  "ledger",
  "voucher",
  "document",
  "firm-profile",
  "invoice-settings",
  "reminder-settings",
]);

export const syncAction = pgEnum("sync_action", ["upsert", "deleted"]);

/** Append-only cursor for offline sync. One row says "this firm row changed". */
export const changeLog = pgTable(
  "change_log",
  {
    seq: bigint("seq", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    firmId: firmId(),
    entity: syncEntity("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: syncAction("action").notNull(),
    changedAt: moment("changed_at").notNull().defaultNow(),
  },
  (t) => [
    index("change_log_firm_seq_idx").on(t.firmId, t.seq),
    index("change_log_firm_entity_idx").on(t.firmId, t.entity, t.entityId),
  ],
);
