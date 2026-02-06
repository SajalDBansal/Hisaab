import { ItemInput, PartyInput } from "@repo/contracts";
import {
  MAX_IMPORT_ERRORS,
  type MasterImportKind,
  type ImportPreview,
  type ImportRowError,
} from "@repo/contracts/src/imports";
import { checkItem, checkParty, STATES, type GstMode } from "@repo/core";
import { IMPORT_COLUMNS, importErrorsCsv, type CsvRead } from "./imports.csv";

export type ImportContext = {
  gstMode: GstMode;
  parties: {
    name: string;
    gstin: string | null;
    type: "customer" | "supplier";
  }[];
  items: { name: string; code: string }[];
  units: { name: string; enabled: boolean }[];
};
export type PreparedRow =
  | { row: number; entity: "party"; input: PartyInput }
  | { row: number; entity: "item"; input: ItemInput };
export type ImportValidation = {
  preview: ImportPreview;
  prepared: PreparedRow[];
};

/** Money columns are decimal rupees; integer conversion never rounds a CSV value. */
export function importPaise(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return Number.NaN;
  const [whole = "0", fraction = ""] = value.split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return paise <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(paise) : Number.NaN;
}
const integer = (value: string) =>
  /^\d+$/.test(value) ? Number(value) : Number.NaN;
const quantity = (value: string) =>
  /^\d+(?:\.\d{1,3})?$/.test(value) ? Number(value) : Number.NaN;
const normalized = (value: string) => value.trim().toLowerCase();

export function validateImport(
  kind: MasterImportKind,
  csv: CsvRead,
  context: ImportContext,
): ImportValidation {
  const errors: ImportRowError[] = [];
  let errorsTruncated = false;
  const invalid = new Set<number>();
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
  const columns = IMPORT_COLUMNS[kind];
  const header = csv.records[0] ?? [];
  if (!errors.length) {
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
  }
  const rows: ImportPreview["rows"] = [];
  const prepared: PreparedRow[] = [];
  const duplicates = new Map<string, number>();
  const duplicate = (
    row: number,
    field: string,
    value: string,
    exists: boolean,
  ) => {
    if (!value) return;
    const key = `${field}:${value}`;
    const previous = duplicates.get(key);
    if (exists)
      add(
        row,
        field,
        "Already exists in this firm. Imports only create new records.",
        "duplicate",
      );
    if (previous !== undefined) {
      add(row, field, `Also appears in record ${previous}.`, "duplicate");
      if (!invalid.has(previous))
        add(previous, field, `Also appears in record ${row}.`, "duplicate");
    } else duplicates.set(key, row);
  };

  if (!invalid.has(1))
    for (const [offset, record] of csv.records.slice(1).entries()) {
      const row = offset + 2;
      const values = Object.fromEntries(
        header.map((h, i) => [h, record[i] ?? ""]),
      );
      rows.push({ row, values });
      if (record.length !== header.length) {
        add(
          row,
          "record",
          `Expected ${header.length} cells; found ${record.length}.`,
          "csv",
        );
        continue;
      }
      const name = values.name ?? "";
      if (kind === "items") {
        const code = values.code ?? "";
        duplicate(
          row,
          "name",
          normalized(name),
          context.items.some((i) => normalized(i.name) === normalized(name)),
        );
        duplicate(
          row,
          "code",
          normalized(code),
          context.items.some((i) => normalized(i.code) === normalized(code)),
        );
        if (code !== code.trim())
          add(
            row,
            "code",
            "Remove outer whitespace from the code; codes are stored exactly as supplied.",
          );
        const parsed = ItemInput.safeParse({
          ...values,
          purchasePrice: importPaise(values.purchasePrice || "0"),
          salePrice: importPaise(values.salePrice ?? ""),
          mrp: importPaise(values.mrp || "0"),
          gstRate: integer(values.gstRate ?? ""),
          reorderLevel: quantity(values.reorderLevel || "0"),
          openingStock: 0,
        });
        if (!parsed.success) {
          parsed.error.issues.forEach((e) =>
            add(row, String(e.path[0] ?? "record"), e.message),
          );
          continue;
        }
        const input = parsed.data;
        const problems = checkItem(input, [], undefined, context.gstMode);
        Object.entries(problems).forEach(([field, message]) => {
          if (message) add(row, field, message);
        });
        if (!context.units.some((u) => u.name === input.unit && u.enabled))
          add(
            row,
            "unit",
            "Choose an enabled unit from this firm's Units list.",
          );
        values.name = input.name;
        values.unit = input.unit;
        prepared.push({ row, entity: "item", input });
      } else {
        const type = kind === "customers" ? "customer" : "supplier";
        const gstin = values.gstin ?? "";
        duplicate(
          row,
          "name",
          normalized(name),
          context.parties.some((p) => normalized(p.name) === normalized(name)),
        );
        duplicate(
          row,
          "gstin",
          gstin,
          context.parties.some((p) => p.type === type && p.gstin === gstin),
        );
        const parsed = PartyInput.safeParse({
          ...values,
          type,
          openingBalance: 0,
          creditDays: integer(values.creditDays || "0"),
          creditLimit: importPaise(values.creditLimit || "0"),
        });
        if (!parsed.success) {
          parsed.error.issues.forEach((e) =>
            add(row, String(e.path[0] ?? "record"), e.message),
          );
          continue;
        }
        const input = parsed.data;
        Object.entries(checkParty(input, [])).forEach(([field, message]) => {
          if (message) add(row, field, message);
        });
        if (!STATES.some((s) => s.code === input.stateCode))
          add(row, "stateCode", "Choose a valid two-digit state code.");
        values.name = input.name;
        prepared.push({ row, entity: "party", input });
      }
    }
  const validRows = invalid.has(1)
    ? 0
    : rows.filter((r) => !invalid.has(r.row)).length;
  return {
    prepared: prepared.filter((r) => !invalid.has(r.row)),
    preview: {
      kind,
      rowCount: rows.length,
      validRows,
      rows,
      errors,
      errorsTruncated,
      canApply: errors.length === 0 && rows.length > 0,
      previewToken: null,
      expiresAt: null,
      errorsCsv: importErrorsCsv(errors, errorsTruncated),
    },
  };
}
