import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/** A named check, such as the database. Returns normally if healthy, throws if not. */
export type ReadyCheck = { name: string; run: () => Promise<void> };

/** Used by load balancers: /health = the process is alive, /ready = it can reach what it needs. */
export async function systemRoutes(
  app: FastifyInstance,
  options: { readyChecks: ReadyCheck[] },
) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    "/health",
    { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
    async () => ({ ok: true as const }),
  );

  typed.get("/ready", async (req, reply) => {
    const checks: Record<string, "ok" | "down"> = {};
    for (const check of options.readyChecks) {
      try {
        await check.run();
        checks[check.name] = "ok";
      } catch (err) {
        req.log.warn({ err, check: check.name }, "Readiness check failed");
        checks[check.name] = "down";
      }
    }
    const ready = Object.values(checks).every((state) => state === "ok");
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });
}
