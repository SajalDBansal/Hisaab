import { PendingOperationError } from "./offlineOperation";

/** A form whose save lost its reply must not become a second save; it is checked in Offline books. */
export function createPendingForm() {
  let originalKey: string | undefined;
  return async function submit<T>(work: () => Promise<T>): Promise<T> {
    if (originalKey)
      throw new PendingOperationError(
        originalKey,
        "This form's last save lost its reply. Open Offline books to check whether it was saved, then close this form before starting another entry.",
      );
    try {
      return await work();
    } catch (error) {
      if (error instanceof PendingOperationError) originalKey = error.key;
      throw error;
    }
  };
}
