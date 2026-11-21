/**
 * Excel (.xlsx) for any report (doc 37, T54), without a library: an xlsx file is
 * a zip of a few XML parts. The zip is "stored" (uncompressed), which every
 * spreadsheet program reads; reports are small, so size doesn't matter.
 * Money is written as numbers in rupees with a 2-decimal format, so totals and
 * sorting work in Excel; text is never a formula.
 */
import type { ReportColumn, ReportDocument } from "./types";

// ---------------------------------------------------------------------------
// Zip (stored entries)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip archive of the given files, uncompressed. */
export function storedZip(
  files: { name: string; data: Uint8Array }[],
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1 Jan 2026 00:00 in DOS date/time; a fixed stamp keeps files reproducible.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true); // made by
    entry.setUint16(6, 20, true); // needed
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + size;
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spreadsheet XML
// ---------------------------------------------------------------------------

/** XML-escape, dropping characters XML can't hold. */
const xml = (value: string) =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const columnName = (index: number) => {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

// Cell styles (cellXfs order below): 0 text, 1 money, 2 bold text, 3 bold money, 4 title, 5 number, 6 bold number
const STYLE = {
  text: 0,
  money: 1,
  boldText: 2,
  boldMoney: 3,
  title: 4,
  number: 5,
  boldNumber: 6,
};

function cell(
  ref: string,
  value: string | number,
  column: ReportColumn | undefined,
  bold: boolean,
): string {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    column?.kind !== "text"
  ) {
    const money = column?.kind === "money";
    const style = money
      ? bold
        ? STYLE.boldMoney
        : STYLE.money
      : bold
        ? STYLE.boldNumber
        : STYLE.number;
    return `<c r="${ref}" s="${style}"><v>${money ? value / 100 : value}</v></c>`;
  }
  const text = String(value ?? "");
  if (!text) return "";
  return `<c r="${ref}" t="inlineStr" s="${bold ? STYLE.boldText : STYLE.text}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(report: ReportDocument): { xml: string; widths: number[] } {
  const rows: string[] = [];
  const widths: number[] = [];
  let r = 0;
  const widen = (i: number, text: string) => {
    widths[i] = Math.min(Math.max(widths[i] ?? 8, text.length + 2), 60);
  };
  const addRow = (cells: string[]) => {
    r += 1;
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
  };
  const title = (text: string, style = STYLE.title) =>
    addRow([
      `<c r="A${r + 1}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(text)}</t></is></c>`,
    ]);

  title(report.title);
  for (const line of [
    report.firmName,
    report.gstin ? `GSTIN ${report.gstin}` : "",
    report.address,
    report.period,
    `Generated ${report.generatedAt}`,
  ].filter(Boolean))
    title(line, STYLE.text);
  addRow([]);
  for (const section of report.sections) {
    title(section.title, STYLE.boldText);
    addRow(
      section.columns.map((c, i) => {
        widen(i, c.label);
        return cell(`${columnName(i)}${r + 1}`, c.label, undefined, true);
      }),
    );
    for (const row of section.rows)
      addRow(
        row.cells.map((value, i) => {
          const column = section.columns[i];
          widen(
            i,
            typeof value === "number" && column?.kind === "money"
              ? (value / 100).toFixed(2)
              : String(value),
          );
          return cell(`${columnName(i)}${r + 1}`, value, column, !!row.total);
        }),
      );
    addRow([]);
  }
  for (const note of report.notes) title(note, STYLE.text);
  return { xml: rows.join(""), widths };
}

/** The report as an .xlsx workbook (one sheet). */
export function reportXlsx(report: ReportDocument): Uint8Array {
  const encoder = new TextEncoder();
  const { xml: sheetRows, widths } = sheetXml(report);
  const cols = widths.length
    ? `<cols>${widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w ?? 10}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const sheetName = xml(
    report.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report",
  );
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return storedZip(
    Object.entries(files).map(([name, content]) => ({
      name,
      data: encoder.encode(content),
    })),
  );
}
