import { PendingOperationError } from "./offlineOperation";

/** A still-open form must not become a new save after its queued request syncs. */
export function createPendingForm() {
  let originalKey: string | undefined;
  return async function submit<T>(work: () => Promise<T>): Promise<T> {
    if (originalKey)
      throw new PendingOperationError(
        originalKey,
        "This form already has a retained save. Open Offline books to review its original result, then close this form before starting another entry.",
      );
    try {
      return await work();
    } catch (error) {
      if (error instanceof PendingOperationError) originalKey = error.key;
      throw error;
    }
  };
}
