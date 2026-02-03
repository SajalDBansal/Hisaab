import { z } from "zod";
import { Id, IsoDate, requiredText } from "./common";

export const DocumentKind = z.enum([
  "bill",
  "receipt",
  "certificate",
  "agreement",
  "other",
]);

// Folder paths are labels inside a firm, never object-storage keys.
export const DocumentFolder = z
  .string()
  .trim()
  .max(200)
  .refine(
    (value) =>
      !value ||
      value
        .split("/")
        .every(
          (part) =>
            !!part.trim() &&
            part === part.trim() &&
            part !== "." &&
            part !== ".." &&
            !part.includes("\\") &&
            [...part].every((char) => char.charCodeAt(0) >= 32),
        ),
    "Use folder names separated by /, without empty or relative paths.",
  );
export const DocumentContentType = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);

/** Step 1 of an upload: tell the server about the file, get a link to upload it to S3 directly. */
export const NewDocumentInput = z.object({
  name: requiredText("Name the document.", 120),
  kind: DocumentKind,
  partyId: Id.optional(),
  voucherId: Id.optional(),
  accountKey: z.string().min(1).max(200).optional(),
  folder: DocumentFolder.optional(),
  note: z.string().max(300).optional(),
});

export const UploadRequest = NewDocumentInput.extend({
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, "Files can be up to 10 MB."),
  contentType: DocumentContentType,
});

export const DocumentListParams = z.object({
  kind: DocumentKind.optional(),
});

export const DocumentFilters = z
  .object({
    kinds: z.array(DocumentKind).max(5).optional(),
    partyIds: z.array(Id).max(100).optional(),
    accountKeys: z.array(z.string().min(1).max(200)).max(100).optional(),
    voucherId: Id.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    dateBy: z.enum(["entry", "upload"]).optional(),
    folder: DocumentFolder.optional(),
    search: z.string().trim().max(120).optional(),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "The end date must follow the start date.",
  );

export const DocumentUpdate = z.object({
  folder: DocumentFolder,
  note: z.string().max(300).optional(),
});

export const StoredDocument = z.object({
  id: Id,
  name: z.string(),
  kind: DocumentKind,
  sizeKb: z.number(),
  hasThumbnail: z.boolean().optional(),
  uploadedOn: IsoDate,
  partyId: Id.optional(),
  voucherId: Id.optional(),
  contentType: DocumentContentType.optional(),
  folder: z.string().optional(),
  accountKey: z.string().optional(),
  partyName: z.string().optional(),
  voucherNumber: z.string().optional(),
  entryDate: IsoDate.optional(),
  note: z.string().optional(),
});

export const UploadTicket = z.object({
  document: StoredDocument,
  key: z.string(),
  uploadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export const DownloadTicket = z.object({
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type NewDocumentInput = z.infer<typeof NewDocumentInput>;
export type UploadRequest = z.infer<typeof UploadRequest>;
export type StoredDocument = z.infer<typeof StoredDocument>;
export type DownloadTicket = z.infer<typeof DownloadTicket>;
