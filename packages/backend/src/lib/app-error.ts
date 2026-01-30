/**
 * An error the shop owner can understand. Throw it from a service and the
 * error plugin turns it into the standard JSON reply.
 *
 *   throw new AppError("BILL_HAS_PAYMENTS", "Money is already settled against this bill.", 422);
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 422,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
