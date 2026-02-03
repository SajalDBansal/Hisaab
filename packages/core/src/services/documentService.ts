import { today } from "../dates";
import { addDocument, removeDocument } from "../mock/db";
import type {
  DocumentFilters,
  DocumentFile,
  NewDocumentInput,
  StoredDocument,
} from "../types";
import { clone, delay, getDb } from "./client";

export interface DocumentRow extends StoredDocument {
  partyName?: string;
  voucherNumber?: string;
}

export const documentService = {
  /** Newest first. Real API: http.get<DocumentRow[]>(`/documents?kind=${kind ?? ""}`) */
  async list(filters: DocumentFilters = {}): Promise<DocumentRow[]> {
    await delay();
    const { documents, parties, vouchers } = getDb();
    return clone(
      documents
        .filter((d) => {
          const voucher = vouchers.find((v) => v.id === d.voucherId);
          const date =
            filters.dateBy === "entry"
              ? (voucher?.date ?? d.uploadedOn)
              : d.uploadedOn;
          return (
            (!filters.kinds?.length || filters.kinds.includes(d.kind)) &&
            (!filters.voucherId || d.voucherId === filters.voucherId) &&
            (!filters.partyIds?.length ||
              filters.partyIds.includes(d.partyId ?? "")) &&
            (!filters.accountKeys?.length ||
              filters.accountKeys.includes(d.accountKey ?? "") ||
              filters.accountKeys.some(
                (key) =>
                  voucher?.journalLines?.some((l) => l.account === key) ||
                  key === `ledger:${voucher?.ledgerId}`,
              )) &&
            (!filters.from || date >= filters.from) &&
            (!filters.to || date <= filters.to) &&
            (filters.folder === undefined ||
              (d.folder ?? "") === filters.folder) &&
            (!filters.search ||
              d.name.toLowerCase().includes(filters.search.toLowerCase()))
          );
        })
        .sort((a, b) => b.uploadedOn.localeCompare(a.uploadedOn))
        .map((d) => ({
          ...d,
          partyName: parties.find((p) => p.id === d.partyId)?.name,
          voucherNumber: vouchers.find((v) => v.id === d.voucherId)?.number,
        })),
    );
  },

  /**
   * Mock upload: saves the details only.
   * Real API: multipart http.post<StoredDocument>("/documents", formData) with the picked file.
   */
  async add(
    input: NewDocumentInput & { file: DocumentFile },
  ): Promise<StoredDocument> {
    await delay();
    const doc = addDocument(getDb(), input, today());
    Object.assign(doc, {
      folder: input.folder ?? "",
      accountKey: input.accountKey,
      contentType: input.file.contentType,
      sizeKb: Math.ceil(input.file.sizeBytes / 1024),
    });
    return clone(doc);
  },

  async folders(): Promise<string[]> {
    return [
      ...new Set(
        getDb()
          .documents.map((d) => d.folder ?? "")
          .filter(Boolean),
      ),
    ].sort();
  },

  async download(
    _id: string,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    throw new Error(
      "Demo documents do not contain stored files. Sign in to use document storage.",
    );
  },

  async update(
    id: string,
    patch: { folder: string; note?: string },
  ): Promise<StoredDocument> {
    const doc = getDb().documents.find((d) => d.id === id);
    if (!doc) throw new Error("Document not found.");
    Object.assign(doc, patch);
    return clone(doc);
  },

  async thumbnail(
    _id: string,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    throw new Error("Demo documents do not contain stored thumbnails.");
  },

  /** Real API: http.delete(`/documents/${id}`) */
  async remove(id: string): Promise<void> {
    await delay();
    removeDocument(getDb(), id);
  },
};
