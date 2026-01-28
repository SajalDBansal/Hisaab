import type { ReportColumn, ReportDocument } from "./types";

/** Money stays in paise until the file is rendered; CSV numbers have no thousands separators. */
export function reportCell(
  value: string | number,
  column: ReportColumn,
  csv = false,
) {
  if (typeof value === "string") return value;
  if (column.kind === "money")
    return csv
      ? (value / 100).toFixed(2)
      : (value / 100).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return String(value);
}

/** Quote every cell and neutralize spreadsheet formulas in user-controlled text only. */
function csvCell(value: string, isNumber = false) {
  const safe =
    !isNumber && /^[\s\u0000-\u001f]*[=+\-@\t\r\n]/.test(value)
      ? `'${value}`
      : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function reportCsv(report: ReportDocument): string {
  const lines = [
    [report.firmName],
    [report.address],
    [report.gstin ? `GSTIN: ${report.gstin}` : ""],
    [report.title, report.period],
    ["Currency", "INR"],
    ["Generated (UTC)", report.generatedAt],
    ...report.notes.map((note) => [note]),
  ].map((line) => line.map((cell) => csvCell(cell)).join(","));
  for (const section of report.sections) {
    lines.push(
      "",
      csvCell(section.title),
      section.columns.map((c) => csvCell(c.label)).join(","),
    );
    for (const row of section.rows)
      lines.push(
        row.cells
          .map((cell, i) =>
            csvCell(
              reportCell(cell, section.columns[i], true),
              typeof cell === "number",
            ),
          )
          .join(","),
      );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

/** Printable tables repeat their headers and keep individual rows together across pages. */
export function reportHtml(report: ReportDocument): string {
  const wide = report.sections.some((section) => section.columns.length > 5);
  const sections = report.sections
    .map(
      (section) => `<section>
    <table><thead><tr><th class="section-title" colspan="${section.columns.length}">${escapeHtml(section.title)}</th></tr><tr>${section.columns.map((c) => `<th class="${c.kind}">${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
    <tbody>${section.rows.length ? section.rows.map((row) => `<tr class="${row.total ? "total" : ""}">${row.cells.map((cell, i) => `<td class="${section.columns[i].kind}">${escapeHtml(reportCell(cell, section.columns[i]))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${section.columns.length}">No entries for this selection.</td></tr>`}</tbody></table>
  </section>`,
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${wide ? 1120 : 800}"><title>${escapeHtml(report.title)}</title><style>
    @page { size: A4 ${wide ? "landscape" : "portrait"}; margin: 12mm; }
    * { box-sizing: border-box; } body { margin: 0; color: #17201b; background: white; font: ${wide ? 11 : 12}px Arial, sans-serif; }
    header { margin-bottom: 18px; } h1 { font-size: 22px; margin: 0 0 6px; } h2 { font-size: 17px; margin: 16px 0 6px; }
    p { margin: 4px 0; overflow-wrap: anywhere; } .muted { color: #526158; } section { margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; } thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; } th, td { padding: 7px 5px; border-bottom: 1px solid #d9e0db; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #edf2ee; font-weight: 600; } .section-title { background: #fff; font-size: 14px; padding: 10px 0; }
    .money, .number { text-align: right; font-variant-numeric: tabular-nums; } .total td { font-weight: 700; background: #f3f6f4; border-top: 1px solid #a6b5aa; }
    footer { margin-top: 20px; font-size: 10px; color: #526158; } footer p { break-inside: avoid; }
  </style></head><body>
    <header><h1>${escapeHtml(report.firmName)}</h1><p class="muted">${escapeHtml(report.address)}</p>${report.gstin ? `<p>GSTIN: ${escapeHtml(report.gstin)}</p>` : ""}<h2>${escapeHtml(report.title)}</h2><p>${escapeHtml(report.period)} | Amounts in INR</p></header>
    ${sections || "<p>No accounts for this selection.</p>"}
    <footer>${report.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}<p>Generated (UTC): ${escapeHtml(report.generatedAt)}</p></footer>
  </body></html>`;
}
