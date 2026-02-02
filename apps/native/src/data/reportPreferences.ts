import { z } from "zod";
import { ReportRequest } from "@repo/contracts/src/reportExports";
import { CashForecastRequest } from "@repo/contracts/src/cashForecast";

const Scope = z
  .object({
    userId: z.string().min(1).max(200),
    firmId: z.string().min(1).max(200),
  })
  .strict();
export type ReportPreferenceScope = z.infer<typeof Scope>;
const identity = {
  id: z.uuid(),
  name: z.string().trim().min(1, "Name the saved filter.").max(60),
};
export const SavedReportFilter = z.discriminatedUnion("kind", [
  z
    .object({
      ...identity,
      kind: z.literal("report"),
      request: ReportRequest,
      format: z.enum(["pdf", "csv"]),
    })
    .strict(),
  z
    .object({
      ...identity,
      kind: z.literal("forecast"),
      request: CashForecastRequest,
    })
    .strict(),
]);
export type SavedReportFilter = z.infer<typeof SavedReportFilter>;
const Preferences = z
  .object({
    version: z.literal(1),
    scope: Scope,
    filters: z.array(SavedReportFilter).max(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const filter of value.filters) {
      const name = `${filter.kind}:${filter.name.toLowerCase()}`;
      if (ids.has(filter.id) || names.has(name))
        ctx.addIssue({
          code: "custom",
          message: "Saved filter ids and names must be unique.",
        });
      ids.add(filter.id);
      names.add(name);
    }
  });

/** update must serialize read/transform/write for a key and resolve only after durable storage. */
export interface ReportPreferenceStorage {
  read(key: string): Promise<string | null>;
  update(
    key: string,
    transform: (stored: string | null) => string,
  ): Promise<void>;
}

export function reportPreferenceKey(scope: ReportPreferenceScope) {
  Scope.parse(scope);
  if (scope.userId === "signed-out")
    throw new Error("Sign in before using saved filters.");
  return JSON.stringify([
    "hisaab-report-preferences-v1",
    scope.userId,
    scope.firmId,
  ]);
}

const MAX_STORED_LENGTH = 256_000;

export function createReportPreferences(
  storage: ReportPreferenceStorage,
  scope: ReportPreferenceScope,
) {
  const owner = Scope.parse(scope);
  const key = reportPreferenceKey(owner);
  const read = (raw: string | null) => {
    if (raw === null)
      return Preferences.parse({ version: 1, scope: owner, filters: [] });
    if (raw.length > MAX_STORED_LENGTH)
      throw new Error("Saved report filters exceed the storage limit.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Saved report filters are damaged and could not be loaded.",
      );
    }
    const result = Preferences.safeParse(parsed);
    if (!result.success)
      throw new Error(
        "Saved report filters are invalid or use an unsupported version.",
      );
    if (reportPreferenceKey(result.data.scope) !== key)
      throw new Error(
        "Saved report filters belong to a different user or firm.",
      );
    return result.data;
  };
  return {
    async list() {
      return read(await storage.read(key)).filters;
    },
    async save(input: SavedReportFilter) {
      const filter = SavedReportFilter.parse(input);
      await storage.update(key, (raw) => {
        const prefs = read(raw);
        const existing = prefs.filters.find((entry) => entry.id === filter.id);
        if (existing && existing.kind !== filter.kind)
          throw new Error("A saved filter cannot change report type.");
        if (
          prefs.filters.some(
            (entry) =>
              entry.id !== filter.id &&
              entry.kind === filter.kind &&
              entry.name.toLowerCase() === filter.name.toLowerCase(),
          )
        )
          throw new Error(
            "That name is already saved. Load it to update it, or choose another name.",
          );
        const filters = [
          ...prefs.filters.filter((entry) => entry.id !== filter.id),
          filter,
        ];
        if (filters.length > 30)
          throw new Error(
            "Keep up to 30 saved filters per firm on this device.",
          );
        const encoded = JSON.stringify(
          Preferences.parse({ ...prefs, filters }),
        );
        if (encoded.length > MAX_STORED_LENGTH)
          throw new Error("Saved report filters exceed the storage limit.");
        return encoded;
      });
      return filter;
    },
    async remove(id: string) {
      z.uuid().parse(id);
      await storage.update(key, (raw) => {
        const prefs = read(raw);
        return JSON.stringify({
          ...prefs,
          filters: prefs.filters.filter((entry) => entry.id !== id),
        });
      });
    },
  };
}

const pending = new Map<string, Promise<unknown>>();
/** Shared across store instances; failed writes must not poison subsequent operations. */
export async function reportPreferenceLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const next = (pending.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(work);
  pending.set(key, next);
  try {
    return await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}
