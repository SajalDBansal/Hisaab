import { MAX_IMPORT_BYTES } from "@repo/contracts/src/imports";

export function pickImportFile(): Promise<{
  name: string;
  text: string;
} | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        if (
          !/\.csv$/i.test(file.name) ||
          file.size < 1 ||
          file.size > MAX_IMPORT_BYTES
        )
          throw new Error("Choose a .csv file between 1 byte and 256 KiB.");
        const text = await file.text();
        if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
          throw new Error("The CSV is larger than 256 KiB.");
        resolve({ name: file.name, text });
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function saveImportFile(fileName: string, text: string) {
  if (
    !/^hisaab-(customers|suppliers|items|opening-balances|open-bills|opening-stock)-(template|errors)\.csv$/.test(
      fileName,
    )
  )
    throw new Error("Invalid CSV file name.");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
