/**
 * Web: make a real PDF in the browser (html2canvas draws the page, jsPDF wraps it),
 * then send it through the device's share sheet when the browser can share files
 * (Android Chrome, Safari, Edge/Chrome on Windows). Otherwise the PDF is downloaded.
 */
export { whatsappText } from "./whatsapp";

/** Draw the HTML in a hidden frame and turn it into a PDF file. */
async function makePdf(html: string, fileName: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:1200px;border:0;";
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const body = frame.contentDocument!.body;
    // Lay the bill out at its own page width (800px A4 formats, 340px thermal),
    // read from the viewport tag that voucherHtml writes.
    const width = Number(/width=(\d+)/.exec(html)?.[1] ?? 800);
    frame.style.width = `${width}px`;
    frame.style.height = `${body.scrollHeight + 20}px`;
    await new Promise((r) => setTimeout(r, 50)); // let fonts and layout settle
    const canvas = await html2canvas(body, {
      scale: 2,
      backgroundColor: "#ffffff",
      windowWidth: width,
    });

    // A4 pages for normal bills; one long strip for the narrow thermal (compact) format
    const narrow = width < 500;
    const pageW = narrow ? 80 : 210; // mm
    const pxPerMm = canvas.width / pageW;
    const pageH = narrow ? canvas.height / pxPerMm : 297;
    const pdf = new jsPDF({ unit: "mm", format: [pageW, pageH] });
    const slice = Math.floor(pageH * pxPerMm); // canvas pixels per page
    for (let y = 0, page = 0; y < canvas.height; y += slice, page++) {
      const part = document.createElement("canvas");
      part.width = canvas.width;
      part.height = Math.min(slice, canvas.height - y);
      part.getContext("2d")!.drawImage(canvas, 0, -y);
      if (page > 0) pdf.addPage([pageW, pageH]);
      pdf.addImage(
        part.toDataURL("image/jpeg", 0.92),
        "JPEG",
        0,
        0,
        pageW,
        part.height / pxPerMm,
      );
    }
    return new File([pdf.output("blob")], fileName, {
      type: "application/pdf",
    });
  } finally {
    frame.remove();
  }
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Make the PDF and share it as a file; download it if the browser can't share files. */
export async function sharePdf(html: string, fileName: string, title: string) {
  const file = await makePdf(html, fileName);
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the sheet
    }
  }
  download(file);
}

/** The browser's print dialog (printer, or Save as PDF). */
export async function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
  });
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 60_000);
}
