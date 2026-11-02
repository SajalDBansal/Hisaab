import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  FirmExportFile,
  FIRM_EXPORT_VERSION,
  LegacyFirmExportFileV2,
  LegacyFirmExportFileV3,
  MAX_FIRM_EXPORT_BYTES,
  MAX_FIRM_EXPORT_ROWS,
  type FirmExportData,
  type FirmExportPayload,
} from "@repo/contracts";
import { ExtendedBackupData } from "@repo/contracts/src/backupExtensions";
import { AppError } from "@repo/backend/lib/app-error";
import { validateExtendedLinks } from "./backup.links";

const invalid = (
  message = "This export is damaged or uses an unsupported format.",
) => new AppError("INVALID_BACKUP", message, 400);

// A checksum detects accidental corruption, not authorship or authenticity.
export function exportDigest(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function checkJsonDepth(value: unknown) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    if (current.depth > 30) throw invalid();
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw invalid();
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
}

// Pre-F04 exports omit this nullable column. Verify their original checksum and exact
// schema before filling it; historical notes keep their issued calculations.
function upgradeReturnAmounts(input: unknown): unknown {
  const lines = (
    input as { payload?: { data?: { voucherLines?: unknown } } } | null
  )?.payload?.data?.voucherLines;
  if (
    !Array.isArray(lines) ||
    !lines.some(
      (line) => line && typeof line === "object" && !("returnAmounts" in line),
    )
  )
    return input;
  for (const schema of [
    FirmExportFile,
    LegacyFirmExportFileV3,
    LegacyFirmExportFileV2,
  ]) {
    const result = schema.safeParse(input);
    if (!result.success) continue;
    const original = input as typeof result.data;
    const payload = {
      ...original.payload,
      data: {
        ...original.payload.data,
        voucherLines: original.payload.data.voucherLines.map((line) => ({
          ...line,
          returnAmounts: line.returnAmounts ?? null,
        })),
      },
    };
    if (
      !isDeepStrictEqual({ ...original, payload }, result.data) ||
      exportDigest(original.payload) !== result.data.integrity.digest
    )
      throw invalid("The legacy export checksum or schema does not match.");
    return {
      ...original,
      payload,
      integrity: { algorithm: "sha256", digest: exportDigest(payload) },
    };
  }
  return input;
}

export function readExport(text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_FIRM_EXPORT_BYTES)
    throw new AppError(
      "EXPORT_TOO_LARGE",
      "Choose an export smaller than 10 MiB.",
      413,
    );
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw invalid("Choose a valid Hisaab JSON export.");
  }
  checkJsonDepth(input);
  input = upgradeVersionThree(upgradeVersionTwo(upgradeReturnAmounts(input)));
  const parsed = FirmExportFile.safeParse(input);
  if (!parsed.success || !isDeepStrictEqual(input, parsed.data))
    throw invalid();
  // Unknown nested fields must fail, not disappear from historical snapshots.
  const raw = input as FirmExportFile;
  if (exportDigest(raw.payload) !== parsed.data.integrity.digest)
    throw invalid(
      "The export checksum does not match. Choose the original, unchanged file.",
    );
  validateExportLinks(parsed.data.payload);
  return parsed.data;
}

function upgradeVersionTwo(input: unknown): unknown {
  const result = LegacyFirmExportFileV2.safeParse(input);
  if (!result.success) return input;
  const original = input as typeof result.data;
  if (
    !isDeepStrictEqual(input, result.data) ||
    exportDigest(original.payload) !== result.data.integrity.digest
  )
    throw invalid("The legacy export checksum or schema does not match.");
  const data = result.data.payload.data;
  const payload = {
    ...result.data.payload,
    version: 3,
    data: {
      ...data,
      parties: data.parties.map((r) => ({ ...r, openingGstBalance: null })),
      ledgers: data.ledgers.map((r) => ({ ...r, openingGstBalance: null })),
      accounts: data.accounts.map((r) => ({ ...r, openingGstBalance: null })),
      openingAccounts: data.openingAccounts.map((r) => ({
        ...r,
        openingGstAmount: null,
      })),
      loans: [],
      loanRepaymentReferences: [],
      loanEvents: [],
      masterImportBatches: [],
    },
  };
  return {
    payload,
    integrity: { algorithm: "sha256", digest: exportDigest(payload) },
  };
}

function upgradeVersionThree(input: unknown): unknown {
  const result = LegacyFirmExportFileV3.safeParse(input);
  if (!result.success) return input;
  const original = input as typeof result.data;
  if (
    !isDeepStrictEqual(input, result.data) ||
    exportDigest(original.payload) !== result.data.integrity.digest
  )
    throw invalid("The legacy export checksum or schema does not match.");
  const data = result.data.payload.data;
  const payload = {
    ...result.data.payload,
    version: FIRM_EXPORT_VERSION,
    data: {
      ...data,
      ...Object.fromEntries(
        Object.keys(ExtendedBackupData).map((name) => [name, []]),
      ),
      items: data.items.map((row) => ({ ...row, openingLots: null })),
      vouchers: data.vouchers.map((row) => ({
        ...row,
        inventoryAdjustment: null,
        delivery: null,
        commission: null,
      })),
      allocations: data.allocations.map((row) => ({
        ...row,
        openingBillId: null,
      })),
    },
  };
  return {
    payload,
    integrity: { algorithm: "sha256", digest: exportDigest(payload) },
  };
}

function ids(rows: { id: string }[]) {
  const values = new Set(rows.map((row) => row.id));
  if (values.size !== rows.length)
    throw invalid("The export contains duplicate record IDs.");
  return values;
}

function reference(value: string | null, available: Set<string>) {
  if (value && !available.has(value))
    throw invalid("The export contains a broken or cross-firm reference.");
}

function accountReference(
  value: string,
  data: { parties: Set<string>; ledgers: Set<string>; accounts: Set<string> },
) {
  const [kind, id] = value.split(":");
  const target =
    kind === "party"
      ? data.parties
      : kind === "ledger"
        ? data.ledgers
        : kind === "account"
          ? data.accounts
          : null;
  if (target) {
    if (value !== `${kind}:${id}`)
      throw invalid("The export contains an invalid account reference.");
    reference(id || "missing", target);
  }
}

// A file is data only: object keys must belong to the document and firm they describe.
export function attachmentManifest(data: FirmExportData) {
  return {
    coverage: "metadata-only" as const,
    binariesIncluded: false as const,
    offsiteRecoveryVerified: false as const,
    objects: data.documents.map((document) => {
      const prefix = `firms/${data.organization.id}/documents/${document.id}`;
      const key = document.s3Key;
      if (
        key &&
        !["", ".jpg", ".png", ".pdf", ".heic", ".heif"].some(
          (ext) => key === prefix + ext,
        )
      )
        throw invalid(
          "An attachment key does not belong to its firm and document.",
        );
      if (
        document.thumbnailKey &&
        (!key || document.thumbnailKey !== `${key}.thumb.jpg`)
      )
        throw invalid("An attachment thumbnail key is not valid.");
      if (document.readyAt && !key)
        throw invalid("A ready attachment is missing its object reference.");
      return {
        documentId: document.id,
        state: document.deletedAt
          ? ("deleted" as const)
          : document.readyAt
            ? ("ready" as const)
            : ("pending" as const),
        originalKey: key,
        thumbnailKey: document.thumbnailKey,
        sizeBytes: document.sizeBytes,
        contentType: document.contentType,
        availability: "not-checked" as const,
      };
    }),
  };
}

export function validateExportLinks(payload: FirmExportPayload) {
  const { data, sourceFirmId } = payload;
  if (data.organization.id !== sourceFirmId) throw invalid();
  let count = 1;
  for (const [name, value] of Object.entries(data)) {
    if (name === "organization" || value === null) continue;
    const rows = Array.isArray(value) ? value : [value];
    count += rows.length;
    for (const row of rows)
      if (!("firmId" in row) || row.firmId !== sourceFirmId)
        throw invalid("An export can contain only one firm's books.");
  }
  if (count > MAX_FIRM_EXPORT_ROWS)
    throw invalid("The export exceeds the record limit.");
  const parties = ids(data.parties),
    items = ids(data.items),
    ledgers = ids(data.ledgers);
  const accounts = ids(data.accounts),
    vouchers = ids(data.vouchers);
  const loans = ids(data.loans);
  validateExtendedLinks(data);
  const openingLots = new Set(
    data.items.flatMap((item) => (item.openingLots ?? []).map((lot) => lot.id)),
  );
  const importTargets = {
    items,
    customers: parties,
    suppliers: parties,
    "opening-balances": ids(data.importedOpeningBalances),
    "open-bills": ids(data.openingBills),
    "opening-stock": openingLots,
  };
  for (const row of data.loans) reference(row.accountId, accounts);
  for (const row of data.loanRepaymentReferences) {
    reference(row.loanId, loans);
    reference(row.voucherId, vouchers);
  }
  for (const row of data.loanEvents) reference(row.loanId, loans);
  for (const row of data.masterImportBatches) {
    if (
      row.result.batchId !== row.id ||
      row.result.kind !== row.kind ||
      row.appliedAt !== row.result.appliedAt ||
      row.result.createdCount !== row.result.createdIds.length
    )
      throw invalid("An import receipt does not match its result.");
    for (const id of row.result.createdIds)
      reference(id, importTargets[row.kind]);
  }
  for (const rows of [
    data.documents,
    data.auditLog,
    data.bookControlEvents,
    data.voucherLines,
    data.voucherCharges,
    data.journalLines,
    data.allocations,
    data.postings,
    data.stockMovements,
    data.loanRepaymentReferences,
    data.loanEvents,
    data.masterImportBatches,
  ])
    ids(rows);
  reference(data.invoiceSettings.bankLedgerId, ledgers);
  for (const voucher of data.vouchers) {
    reference(voucher.partyId, parties);
    reference(voucher.ledgerId, ledgers);
    reference(voucher.toLedgerId, ledgers);
    for (const id of [
      voucher.againstId,
      voucher.sourceId,
      voucher.convertedToId,
    ])
      reference(id, vouchers);
    for (const id of Object.keys(voucher.bankClearings ?? {}))
      reference(id, ledgers);
    if (voucher.snapshot) {
      if (voucher.snapshot.firm.id !== sourceFirmId) throw invalid();
      reference(voucher.snapshot.party?.id ?? null, parties);
      reference(voucher.snapshot.settings.bankLedgerId ?? null, ledgers);
      for (const item of voucher.snapshot.items) reference(item.id, items);
    }
  }
  for (const rows of [
    data.voucherLines,
    data.voucherCharges,
    data.journalLines,
    data.allocations,
    data.postings,
    data.stockMovements,
    data.auditLog,
  ]) {
    for (const row of rows) reference(row.voucherId, vouchers);
  }
  for (const row of [...data.voucherLines, ...data.stockMovements])
    reference(row.itemId, items);
  for (const row of data.allocations) {
    reference(row.billId, vouchers);
    reference(row.openingPartyId, parties);
  }
  for (const row of data.remindersSent) reference(row.partyId, parties);
  for (const row of [
    ...data.openingAccounts,
    ...data.journalLines,
    ...data.postings,
  ])
    accountReference(row.account, { parties, ledgers, accounts });
  for (const document of data.documents) {
    reference(document.partyId, parties);
    reference(document.voucherId, vouchers);
    if (document.accountKey)
      accountReference(document.accountKey, { parties, ledgers, accounts });
  }
  const expected = attachmentManifest(data);
  if (exportDigest(expected) !== exportDigest(payload.attachments))
    throw invalid(
      "The attachment manifest does not match the document records.",
    );
}
