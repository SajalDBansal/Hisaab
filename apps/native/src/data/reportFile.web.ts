import { reportCsv, reportXlsx, type ReportDocument } from "@repo/core";
import { makeReportPdf } from "./reportPdf.web";

export type ReportFormat = "pdf" | "csv" | "xlsx";

/** A JSON file (the GSTR-1 upload file), downloaded directly. */
export async function saveJsonFile(fileName: string, data: unknown) {
  download(
    new Blob([JSON.stringify(data)], { type: "application/json" }),
    `${fileName}.json`,
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Web exports download a file directly, without requiring a browser share gesture. */
export async function saveReportFile(
  report: ReportDocument,
  format: ReportFormat,
) {
  const blob =
    format === "csv"
      ? new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" })
      : format === "xlsx"
        ? new Blob([reportXlsx(report) as BlobPart], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        : await makeReportPdf(report);
  download(blob, `${report.fileName}.${format}`);
}
