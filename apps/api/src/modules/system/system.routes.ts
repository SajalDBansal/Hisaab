import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/** Returns normally if healthy, throws if not. Each check must also bound its I/O. */
export type ReadyCheck = { name: string; run: () => Promise<void> };

type CheckResults = Record<string, "ok" | "down">;

/** Used by load balancers: /health = the process is alive, /ready = it can reach what it needs. */
export async function systemRoutes(
  app: FastifyInstance,
  options: { readyChecks: ReadyCheck[] },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  let pending: Promise<CheckResults> | undefined;

  function checkReadiness() {
    if (pending) return pending;
    const checks: CheckResults = Object.fromEntries(
      options.readyChecks.map((check) => [check.name, "down"]),
    );
    // Share one round, including its deadline. If a dependency never settles,
    // keep returning its failed snapshot instead of queuing more probes.
    pending = new Promise<CheckResults>((resolve) => {
      const finish = () => resolve({ ...checks });
      const timer = setTimeout(finish, 3_000);
      void Promise.all(
        options.readyChecks.map(async (check) => {
          try {
            await check.run();
            checks[check.name] = "ok";
          } catch {
            app.log.warn({ check: check.name }, "Readiness check failed");
          }
        }),
      ).then(() => {
        clearTimeout(timer);
        finish();
        pending = undefined;
      });
    });
    return pending;
  }

  typed.get(
    "/health",
    {
      config: { rateLimit: false },
      schema: { response: { 200: z.object({ ok: z.literal(true) }) } },
    },
    async () => ({ ok: true as const }),
  );

  typed.get("/ready", { config: { rateLimit: false } }, async (_req, reply) => {
    const checks = await checkReadiness();
    const ready = Object.values(checks).every((state) => state === "ok");
    return reply
      .header("cache-control", "no-store")
      .code(ready ? 200 : 503)
      .send({ ready, checks });
  });
}
