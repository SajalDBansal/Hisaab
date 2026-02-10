const port = Number(process.env.WORKER_HEALTH_PORT || 3011);
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(1);
try {
  const response = await fetch(`http://127.0.0.1:${port}/ready`, {
    signal: AbortSignal.timeout(3_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
export {};
