import { chromium } from "playwright-core";
import { AppError } from "@repo/backend/lib/app-error";
import type { PdfRenderer } from "@repo/backend/modules/server-pdf/server-pdf.service";

// Only render our generated HTML: no page scripts, external requests or file URLs.
export function createPdfRenderer(executablePath: string): PdfRenderer {
  return async (html, compact) => {
    if (Buffer.byteLength(html) > 2 * 1024 * 1024)
      throw new AppError(
        "PDF_TOO_LARGE",
        "This entry is too large to print on the server.",
      );
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      chromiumSandbox: true,
      timeout: 30_000,
    });
    const timer = setTimeout(() => {
      void browser.close().catch(() => {});
    }, 30_000);
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      await context.route("**/*", (route) => route.abort());
      const page = await context.newPage();
      const policy =
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'\">";
      await page.setContent(html.replace("<head>", `<head>${policy}`), {
        waitUntil: "load",
        timeout: 15_000,
      });
      return await page.pdf({
        ...(compact ? { width: "80mm", height: "297mm" } : { format: "A4" }),
        printBackground: true,
        margin: { top: "8mm", bottom: "8mm", left: "5mm", right: "5mm" },
      });
    } finally {
      clearTimeout(timer);
      await browser.close();
    }
  };
}
