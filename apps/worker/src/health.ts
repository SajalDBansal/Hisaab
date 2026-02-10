import { createServer } from "node:http";

export async function within<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Worker dependency timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// This endpoint is loopback-only and never returns dependency URLs or credentials.
export async function startHealthServer(
  port: number,
  ready: () => Promise<boolean>,
) {
  let pending: Promise<boolean> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/ready") {
      response.writeHead(404).end();
      return;
    }
    let healthy = false;
    try {
      pending ??= ready().finally(() => {
        pending = undefined;
      });
      healthy = await within(pending, 2_000);
    } catch {
      /* Dependency failure is represented by HTTP 503. */
    }
    response.writeHead(healthy ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ status: healthy ? "ready" : "unavailable" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
