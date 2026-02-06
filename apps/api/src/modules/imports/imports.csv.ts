import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_ROWS,
  type ImportKind,
  type ImportRowError,
  type ImportTemplate,
} from "@repo/contracts/src/imports";

/** Inject csv-parse/sync's parse; never fall back to an ad hoc CSV reader. */
export type CsvParser = (
  text: string,
  options: {
    bom: boolean;
    cast: boolean;
    columns: boolean;
    skip_empty_lines: boolean;
    relax_column_count: boolean;
    max_record_size: number;
    to: number;
  },
) => unknown;

export const IMPORT_COLUMNS = {
  customers: [
    "name",
    "phone",
    "city",
    "stateCode",
    "gstin",
    "creditDays",
    "creditLimit",
  ],
  suppliers: [
    "name",
    "phone",
    "city",
    "stateCode",
    "gstin",
    "creditDays",
    "creditLimit",
  ],
  items: [
    "name",
    "code",
    "hsn",
    "group",
    "taxType",
    "gstRate",
    "unit",
    "purchasePrice",
    "salePrice",
    "mrp",
    "reorderLevel",
  ],
  "opening-balances": ["targetKind", "targetId", "date", "amount", "gstAmount"],
  "open-bills": ["partyId", "number", "date", "dueDate", "amount", "gstAmount"],
  "opening-stock": [
    "itemId",
    "lotNumber",
    "date",
    "bookScope",
    "quantity",
    "unitCost",
  ],
} as const;

/** Quoting alone does not prevent spreadsheet formula execution. */
export function importCsvCell(value: string | number) {
  const text = String(value);
  const safe =
    /^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text)
      ? `'${text}`
      : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function importErrorsCsv(errors: ImportRowError[], truncated: boolean) {
  const rows: (string | number)[][] = [
    ["record", "field", "code", "message"],
    ...errors.map((e) => [e.row, e.field, e.code, e.message]),
  ];
  if (truncated)
    rows.push([
      "",
      "",
      "limit",
      "More errors exist. Correct these errors and preview again.",
    ]);
  return (
    "\uFEFF" +
    rows.map((r) => r.map(importCsvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

export function importTemplate(kind: ImportKind): ImportTemplate {
  // Header only, so an example customer or item cannot be imported accidentally.
  return {
    fileName: `hisaab-${kind}-template.csv`,
    text: "\uFEFF" + IMPORT_COLUMNS[kind].map(importCsvCell).join(",") + "\r\n",
  };
}

export type CsvRead = { records: string[][]; errors: ImportRowError[] };
export function readImportCsv(text: string, parse: CsvParser): CsvRead {
  const fail = (code: ImportRowError["code"], message: string): CsvRead => ({
    records: [],
    errors: [{ row: 1, field: "file", code, message }],
  });
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES)
    return fail("limit", "The CSV must be no larger than 256 KiB.");
  if (Buffer.from(text, "utf8").toString("utf8") !== text)
    return fail(
      "csv",
      "Use well-formed UTF-8 text without unpaired surrogates.",
    );
  // eslint-disable-next-line no-control-regex -- Reject binary/control characters in uploaded text.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/u.test(text))
    return fail(
      "csv",
      "Use a UTF-8 CSV without control characters or invalid text.",
    );
  try {
    const result = parse(text, {
      bom: true,
      cast: false,
      columns: false,
      skip_empty_lines: false,
      relax_column_count: true,
      max_record_size: 16_384,
      to: MAX_IMPORT_ROWS + 2,
    });
    if (
      !Array.isArray(result) ||
      result.some(
        (r: unknown) =>
          !Array.isArray(r) || r.some((c: unknown) => typeof c !== "string"),
      )
    )
      throw new Error("Unexpected CSV parser result.");
    const records = result as string[][];
    if (records.length > MAX_IMPORT_ROWS + 1)
      return fail(
        "limit",
        `Import at most ${MAX_IMPORT_ROWS} data records at once.`,
      );
    if (
      records.some(
        (r) =>
          r.length > 20 || r.some((c) => c.length > MAX_IMPORT_CELL_LENGTH),
      )
    )
      return fail(
        "limit",
        "Use at most 20 columns and 500 characters per cell.",
      );
    return { records, errors: [] };
  } catch {
    // Parser errors may quote the source file. Return a bounded, non-sensitive message.
    return fail(
      "csv",
      "Invalid CSV quoting or record size. Use comma-separated UTF-8 CSV with double-quoted fields.",
    );
  }
}
