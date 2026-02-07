import { Id, IsoDate, Quantity } from "@repo/contracts";
import {
  MAX_IMPORT_ERRORS,
  type FinancialImportKind,
  type ImportPreview,
  type ImportRowError,
} from "@repo/contracts/src/imports";
import {
  MAX_OPENING_IMPORT_PAISE,
  openingImportTotals,
  reconcileOpeningBills,
  type OpeningMoneyRow,
  type OpeningBillRow,
  type OpeningStockRow,
} from "@repo/core/src/accounting/openingImport";
import { IMPORT_COLUMNS, importErrorsCsv, type CsvRead } from "./imports.csv";
import { importPaise } from "./imports.validation";

export type FinancialContext = {
  fyStart: string;
  today: string;
  defaultGst: boolean;
  locked: boolean;
  hasActivity: boolean;
  version: number;
  parties: {
    id: string;
    type: "customer" | "supplier";
    openingBalance: number;
    openingGstBalance: number | null;
    openingDate: string;
    version: number;
  }[];
  ledgers: {
    id: string;
    openingBalance: number;
    openingGstBalance: number | null;
    version: number;
  }[];
  accounts: {
    id: string;
    openingBalance: number;
    openingGstBalance: number | null;
    version: number;
  }[];
  items: {
    id: string;
    openingStock: number;
    version: number;
    importedOpening?: boolean;
    openingLots:
      | {
          id: string;
          qty: number;
          unitCost: number;
          bookScope: "gst" | "nongst";
        }[]
      | null;
  }[];
  initialized: { targetKind: string; targetId: string }[];
  billParties: string[];
};
export type PreparedFinancialImport = {
  money: OpeningMoneyRow[];
  bills: OpeningBillRow[];
  stock: OpeningStockRow[];
};

function signedPaise(value: string) {
  return value.startsWith("-")
    ? -importPaise(value.slice(1))
    : importPaise(value);
}

export function validateFinancialImport(
  kind: FinancialImportKind,
  csv: CsvRead,
  context: FinancialContext,
) {
  const errors: ImportRowError[] = [];
  const invalid = new Set<number>();
  let errorsTruncated = false;
  const add = (
    row: number,
    field: string,
    message: string,
    code: ImportRowError["code"] = "invalid",
  ) => {
    invalid.add(row);
    if (errors.length < MAX_IMPORT_ERRORS)
      errors.push({
        row,
        field: field.slice(0, 80),
        message: message.slice(0, 500),
        code,
      });
    else errorsTruncated = true;
  };
  csv.errors.forEach((e) => add(e.row, e.field, e.message, e.code));
  const header = csv.records[0] ?? [];
  const columns = IMPORT_COLUMNS[kind];
  if (
    header.length !== columns.length ||
    new Set(header).size !== header.length ||
    columns.some((c) => !header.includes(c))
  )
    add(
      1,
      "header",
      `Use exactly these columns: ${columns.join(", ")}.`,
      "header",
    );
  if (csv.records.length < 2)
    add(1, "file", "Add at least one data record.", "csv");
  const readable = !invalid.has(1);
  if (context.locked)
    add(
      1,
      "books",
      "Opening balances are approved or a period is closed. Reopen them before import.",
    );
  if (context.hasActivity)
    add(
      1,
      "books",
      "Financial opening imports require cutover books with no posted activity.",
    );
  const rows: ImportPreview["rows"] = [];
  const prepared: PreparedFinancialImport = { money: [], bills: [], stock: [] };
  const seen = new Map<string, number>();
  const duplicate = (
    key: string,
    row: number,
    field: string,
    exists: boolean,
  ) => {
    if (exists)
      add(
        row,
        field,
        "An opening already exists. Imports never overwrite existing openings.",
        "duplicate",
      );
    const previous = seen.get(key);
    if (previous !== undefined) {
      add(row, field, `Also appears in record ${previous}.`, "duplicate");
      add(previous, field, `Also appears in record ${row}.`, "duplicate");
    } else seen.set(key, row);
  };
  const money = (value: string, row: number, field: string, signed = false) => {
    const n = signed ? signedPaise(value) : importPaise(value);
    if (!Number.isSafeInteger(n) || Math.abs(n) > MAX_OPENING_IMPORT_PAISE)
      add(
        row,
        field,
        "Use decimal rupees with at most 2 places, within 10,000,000,000 rupees.",
      );
    return n;
  };
  if (readable)
    for (const [offset, record] of csv.records.slice(1).entries()) {
      const row = offset + 2;
      const v = Object.fromEntries(header.map((h, i) => [h, record[i] ?? ""]));
      rows.push({ row, values: v });
      if (record.length !== header.length) {
        add(row, "record", "The record has the wrong number of cells.", "csv");
        continue;
      }
      const date = v.date ?? "";
      if (!IsoDate.safeParse(date).success || date > context.today)
        add(
          row,
          "date",
          "Use a valid YYYY-MM-DD date that is not in the future.",
        );
      if (kind === "opening-balances") {
        const targetKind = v.targetKind as OpeningMoneyRow["targetKind"];
        const targetId = v.targetId ?? "";
        const targets =
          targetKind === "party"
            ? context.parties
            : targetKind === "ledger"
              ? context.ledgers
              : targetKind === "account"
                ? context.accounts
                : [];
        const target = targets.find((t) => t.id === targetId);
        if (!Id.safeParse(targetId).success || !target)
          add(
            row,
            "targetId",
            "Choose an existing live party, cash/bank ledger or custom account in this firm.",
          );
        const amount = money(v.amount ?? "", row, "amount", true);
        const gstAmount = money(v.gstAmount ?? "", row, "gstAmount", true);
        if (amount === 0)
          add(row, "amount", "An opening balance must be nonzero.");
        if (gstAmount < Math.min(0, amount) || gstAmount > Math.max(0, amount))
          add(
            row,
            "gstAmount",
            "The GST share must have the total's sign and cannot exceed it.",
          );
        if (date !== context.fyStart)
          add(row, "date", "Use the firm's financial-year opening date.");
        duplicate(
          `${targetKind}:${targetId}`,
          row,
          "targetId",
          (!!target &&
            (target.openingBalance !== 0 ||
              target.openingGstBalance !== null)) ||
            context.initialized.some(
              (t) => t.targetKind === targetKind && t.targetId === targetId,
            ) ||
            context.billParties.includes(targetId),
        );
        if (!invalid.has(row))
          prepared.money.push({
            row,
            targetKind,
            targetId,
            date,
            amount,
            gstAmount,
          });
      } else if (kind === "open-bills") {
        const partyId = v.partyId ?? "";
        const party = context.parties.find((p) => p.id === partyId);
        const number = v.number ?? "";
        if (!Id.safeParse(partyId).success || !party)
          add(row, "partyId", "Choose an existing live party in this firm.");
        if (!number || number.length > 80 || number !== number.trim())
          add(
            row,
            "number",
            "Use a bill number up to 80 characters without outer whitespace.",
          );
        duplicate(
          `${partyId}:${number.toLowerCase()}`,
          row,
          "number",
          context.billParties.includes(partyId),
        );
        const amount = money(v.amount ?? "", row, "amount");
        const gstAmount = money(v.gstAmount ?? "", row, "gstAmount");
        if (amount <= 0 || gstAmount > amount)
          add(
            row,
            "amount",
            "Bill amount must be positive and at least its GST-book share.",
          );
        const dueDate = v.dueDate ?? "";
        if (!IsoDate.safeParse(dueDate).success || dueDate < date)
          add(
            row,
            "dueDate",
            "Use a valid due date on or after the bill date.",
          );
        if (
          party &&
          (date > party.openingDate || party.openingDate > context.today)
        )
          add(
            row,
            "date",
            "The bill must exist on the party's opening date, which cannot be in the future.",
          );
        if (!invalid.has(row) && party)
          prepared.bills.push({
            row,
            partyId,
            number,
            date,
            dueDate,
            openingDate: party.openingDate,
            amount,
            gstAmount,
          });
      } else {
        const itemId = v.itemId ?? "";
        const item = context.items.find((i) => i.id === itemId);
        if (!Id.safeParse(itemId).success || !item)
          add(row, "itemId", "Choose an existing live item in this firm.");
        const lotNumber = v.lotNumber ?? "";
        if (
          !lotNumber ||
          lotNumber.length > 80 ||
          lotNumber !== lotNumber.trim()
        )
          add(
            row,
            "lotNumber",
            "Use a lot number up to 80 characters without outer whitespace.",
          );
        duplicate(
          `${itemId}:${lotNumber.toLowerCase()}`,
          row,
          "lotNumber",
          !!item?.openingStock ||
            !!item?.openingLots?.length ||
            !!item?.importedOpening,
        );
        if (date !== context.fyStart)
          add(row, "date", "Use the firm's financial-year opening date.");
        const bookScope = v.bookScope as OpeningStockRow["bookScope"];
        if (bookScope !== "gst" && bookScope !== "nongst")
          add(row, "bookScope", "Choose gst or nongst.");
        const quantity = /^\d+(?:\.\d{1,3})?$/.test(v.quantity ?? "")
          ? Number(v.quantity)
          : Number.NaN;
        if (!Quantity.safeParse(quantity).success || quantity <= 0)
          add(
            row,
            "quantity",
            "Use a positive base-unit quantity with at most 3 decimals.",
          );
        const unitCost = money(v.unitCost ?? "", row, "unitCost");
        const value = Math.round(quantity * unitCost);
        if (!Number.isSafeInteger(value) || value > MAX_OPENING_IMPORT_PAISE)
          add(
            row,
            "unitCost",
            "The lot value exceeds the opening amount limit.",
          );
        if (!invalid.has(row))
          prepared.stock.push({
            row,
            itemId,
            lotNumber,
            date,
            bookScope,
            quantity,
            unitCost,
            value,
          });
      }
    }
  for (const itemId of new Set(prepared.stock.map((r) => r.itemId))) {
    const lots = prepared.stock.filter((r) => r.itemId === itemId);
    const quantity =
      lots.reduce((sum, r) => sum + Math.round(r.quantity * 1000), 0) / 1000;
    if (!Quantity.safeParse(quantity).success)
      lots.forEach((r) =>
        add(
          r.row,
          "quantity",
          "The item's total opening quantity exceeds the supported limit.",
        ),
      );
  }
  const parties = reconcileOpeningBills(
    context.parties.map((p) => ({
      ...p,
      openingGstBalance: p.openingGstBalance ?? undefined,
    })),
    prepared.bills,
    context.defaultGst,
  );
  for (const p of parties)
    if (
      p.expected <= 0 ||
      p.expected !== p.actual ||
      p.expectedGst !== p.actualGst
    )
      for (const b of prepared.bills.filter((b) => b.partyId === p.partyId))
        add(
          b.row,
          "amount",
          "All bills for this party must exactly reconcile to its positive trade opening and GST-book share.",
        );
  const reconciliation = {
    totals: openingImportTotals(prepared.money, prepared.bills, prepared.stock),
    parties,
    reconciled: !invalid.size,
  };
  const preview: ImportPreview = {
    kind,
    rowCount: rows.length,
    validRows: invalid.has(1)
      ? 0
      : rows.filter((r) => !invalid.has(r.row)).length,
    rows,
    errors,
    errorsTruncated,
    canApply: !invalid.size && rows.length > 0,
    previewToken: null,
    expiresAt: null,
    errorsCsv: importErrorsCsv(errors, errorsTruncated),
    reconciliation,
  };
  return { preview, prepared };
}
