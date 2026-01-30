import { AppError } from "@repo/backend/lib/app-error";

// Drizzle wraps database errors; expose only the known accounting-control failure.
export function bookControlError(error: unknown): AppError | undefined {
  let cause = error;
  for (
    let depth = 0;
    depth < 4 && cause && typeof cause === "object";
    depth++
  ) {
    if ("code" in cause && cause.code === "P0010")
      return new AppError(
        "OPENINGS_LOCKED",
        "Opening balances are approved. Ask the owner to reopen them before making this change.",
        409,
      );
    cause = "cause" in cause ? cause.cause : undefined;
  }
}
