import { reportCsv, type ReportDocument } from "@repo/core";
import { makeReportPdf } from "./reportPdf.web";

export type ReportFormat = "pdf" | "csv";

/** Web exports download a file directly, without requiring a browser share gesture. */
export async function saveReportFile(
  report: ReportDocument,
  format: ReportFormat,
) {
  const blob =
    format === "csv"
      ? new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" })
      : await makeReportPdf(report);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.fileName}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
