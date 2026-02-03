import { reportCsv, reportHtml, type ReportDocument } from "@repo/core";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

export type ReportFormat = "pdf" | "csv";

/** Phone exports use the system share sheet so users can choose Files, Drive, email or another app. */
export async function saveReportFile(
  report: ReportDocument,
  format: ReportFormat,
) {
  if (
    format === "pdf" &&
    report.sections.reduce((n, s) => n + s.rows.length, 0) > 5_000
  )
    throw new Error(
      "This PDF is too large. Download CSV or choose a shorter period.",
    );
  if (!(await Sharing.isAvailableAsync()))
    throw new Error("File sharing is unavailable on this device.");
  const file = new File(Paths.cache, `${report.fileName}.${format}`);
  if (file.exists) file.delete();
  if (format === "csv") {
    file.create();
    file.write(reportCsv(report));
  } else {
    const landscape = report.sections.some((s) => s.columns.length > 5);
    const pdf = await Print.printToFileAsync({
      html: reportHtml(report),
      base64: true,
      width: landscape ? 842 : 595,
      height: landscape ? 595 : 842,
    });
    try {
      if (!pdf.base64)
        throw new Error("Couldn't create the PDF. Please try again.");
      file.create();
      file.write(pdf.base64, { encoding: "base64" });
    } finally {
      const temporary = new File(pdf.uri);
      if (temporary.exists) temporary.delete();
    }
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: format === "pdf" ? "application/pdf" : "text/csv",
    UTI:
      format === "pdf" ? "com.adobe.pdf" : "public.comma-separated-values-text",
    dialogTitle: report.title,
  });
}
