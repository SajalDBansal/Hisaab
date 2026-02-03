import { reportHtml, type ReportDocument } from "@repo/core";

/** Paginate at table row boundaries and repeat table headers instead of cutting a tall screenshot. */
function paginate(doc: Document, width: number, height: number) {
  const header = doc.querySelector("header")!;
  const tables = [...doc.querySelectorAll("table")];
  const notes = [...doc.querySelectorAll("footer p")];
  const pages: HTMLDivElement[] = [];
  let page: HTMLDivElement;
  const newPage = () => {
    page = doc.createElement("div");
    page.style.cssText = `width:${width}px;min-height:${height}px;background:white;display:flow-root;`;
    page.appendChild(header.cloneNode(true));
    doc.body.appendChild(page);
    pages.push(page);
  };
  const filled = () => {
    const last = page.lastElementChild!;
    return (
      last.getBoundingClientRect().bottom - page.getBoundingClientRect().top
    );
  };
  newPage();
  const empty = doc.querySelector("body > p");
  if (empty) page!.appendChild(empty.cloneNode(true));
  for (const table of tables) {
    let target: HTMLTableElement;
    const startTable = () => {
      target = table.cloneNode(false) as HTMLTableElement;
      target.style.marginTop = "12px";
      target.appendChild(table.tHead!.cloneNode(true));
      target.createTBody();
      page.appendChild(target);
    };
    startTable();
    for (const row of [...table.tBodies[0].rows]) {
      const copy = row.cloneNode(true) as HTMLTableRowElement;
      target!.tBodies[0].appendChild(copy);
      if (filled() <= height) continue;
      copy.remove();
      if (!target!.tBodies[0].rows.length) target!.remove();
      newPage();
      startTable();
      target!.tBodies[0].appendChild(copy);
      if (filled() > height)
        throw new Error(
          "A report row is too long for PDF. Download CSV instead.",
        );
    }
  }
  for (const note of notes) {
    const copy = note.cloneNode(true) as HTMLParagraphElement;
    copy.style.cssText = "font-size:10px;color:#526158;margin-top:10px";
    page!.appendChild(copy);
    if (filled() > height) {
      copy.remove();
      newPage();
      page!.appendChild(copy);
    }
  }
  return pages;
}

/** Rasterized browser text preserves Indian names and scripts without shipping separate PDF fonts. */
export async function makeReportPdf(report: ReportDocument): Promise<Blob> {
  if (report.sections.reduce((n, s) => n + s.rows.length, 0) > 5_000)
    throw new Error(
      "This PDF is too large. Download CSV or choose a shorter period.",
    );
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const landscape = report.sections.some((s) => s.columns.length > 5);
  const width = landscape ? 1120 : 800;
  const pageWidth = landscape ? 297 : 210;
  const pageHeight = landscape ? 210 : 297;
  const contentWidth = pageWidth - 24;
  const height = Math.floor(((pageHeight - 30) * width) / contentWidth);
  const frame = document.createElement("iframe");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:1200px;border:0`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = reportHtml(report);
    });
    const doc = frame.contentDocument!;
    await doc.fonts.ready;
    const pages = paginate(doc, width, height);
    const pdf = new jsPDF({
      orientation: landscape ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    for (const [index, page] of pages.entries()) {
      // Capture each page at the origin; offscreen offsets can clip cloned table headers.
      doc.body.replaceChildren(page);
      const canvas = await html2canvas(page, {
        scale: 1.5,
        backgroundColor: "#ffffff",
        windowWidth: width,
      });
      if (index) pdf.addPage();
      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        12,
        12,
        contentWidth,
        (canvas.height * contentWidth) / canvas.width,
        undefined,
        "FAST",
      );
      pdf.setFontSize(8);
      pdf.setTextColor(82, 97, 88);
      pdf.text(
        `Page ${index + 1} of ${pages.length}`,
        pageWidth - 12,
        pageHeight - 8,
        { align: "right" },
      );
    }
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}
