import { formatDate } from "@repo/core";

/** "2026-10-06T12:30:00Z" → "06-10-2026, 6:00 pm" in the phone's own time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const h = d.getHours();
  const time = `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? "am" : "pm"}`;
  return `${formatDate(local)}, ${time}`;
}
