import pg from "pg";

type QueryCall = (...args: unknown[]) => unknown;
type QueryCallback = (error: Error | null, ...result: unknown[]) => void;

// pg's read timeout rejects a query without closing a checked-out transaction.
// Destroy that socket as well, so it cannot block or re-enter the pool.
export class DeadlineClient extends pg.Client {
  constructor(config?: pg.ClientConfig) {
    super(config);
    // Checked-out clients have no pool error listener; queries carry the failure.
    this.on("error", () => undefined);
    const query = this.query.bind(this) as QueryCall;
    this.query = ((...args: unknown[]) => {
      const last = args.length - 1;
      const callback = args[last];
      if (typeof callback === "function") {
        args[last] = (error: Error | null, ...result: unknown[]) => {
          this.discardTimedOutConnection(error);
          (callback as QueryCallback)(error, ...result);
        };
        return query(...args);
      }
      const result = query(...args);
      if (result instanceof Promise)
        return result.catch((error: unknown) => {
          this.discardTimedOutConnection(error);
          throw error;
        });
      return result;
    }) as pg.Client["query"];
  }

  private discardTimedOutConnection(error: unknown) {
    if (!(error instanceof Error) || error.message !== "Query read timeout")
      return;
    // Mark the client ended before destroying; Pool.release then discards it.
    void this.end();
    this.connection.stream.destroy();
  }
}
