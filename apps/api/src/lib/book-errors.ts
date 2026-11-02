import { AppError } from "@repo/backend/lib/app-error";

// Drizzle wraps database errors; expose only known accounting-control failures.
export function bookControlError(error: unknown): AppError | undefined {
  let cause = error;
  const seen = new Set<object>();
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    if ("code" in cause && cause.code === "P0010")
      return new AppError(
        "OPENINGS_LOCKED",
        "Opening balances are approved. Ask the owner to reopen them before making this change.",
        409,
      );
    if ("code" in cause && cause.code === "P0021")
      return new AppError(
        "IMPORTED_OPENING_IMMUTABLE",
        "Imported opening fields cannot be changed and their records cannot be deleted, even after reopening balances. Ask the owner to review the import and correct the books using the appropriate settlement, journal or inventory adjustment.",
        409,
      );
    cause = "cause" in cause ? cause.cause : undefined;
  }
}
