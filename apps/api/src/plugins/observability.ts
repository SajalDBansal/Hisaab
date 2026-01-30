import type { FastifyInstance, FastifyRequest } from "fastify";
import { metricAlerts, metricsText, recordRequest } from "../lib/metrics";
import { logErrorReporter, type ErrorReporter } from "@repo/backend/lib/observability";
import { AppError } from "@repo/backend/lib/app-error";

declare module "fastify" {
  interface FastifyRequest {
    observabilityStart?: bigint;
  }
}

function userIdOf(req: FastifyRequest) {
  return "user" in req &&
    typeof req.user === "object" &&
    req.user &&
    "id" in req.user
    ? req.user.id
    : undefined;
}

function firmIdOf(req: FastifyRequest) {
  return "firm" in req &&
    typeof req.firm === "object" &&
    req.firm &&
    "id" in req.firm
    ? req.firm.id
    : undefined;
}

function routeOf(req: FastifyRequest) {
  // Keep metrics low-cardinality: unknown paths share one route label.
  return req.routeOptions.url ?? "UNMATCHED";
}

function durationMs(req: FastifyRequest) {
  const start = req.observabilityStart;
  return start ? Number(process.hrtime.bigint() - start) / 1_000_000 : 0;
}

function shouldCapture(error: Error) {
  if (error instanceof AppError) return error.status >= 500;
  const status = "statusCode" in error ? error.statusCode : undefined;
  return typeof status === "number" ? status >= 500 : true;
}

export function registerObservability(
  app: FastifyInstance,
  reporter: ErrorReporter = logErrorReporter(app.log),
) {
  app.addHook("onRequest", async (req) => {
    req.observabilityStart = process.hrtime.bigint();
  });

  app.addHook("onError", async (req, _reply, error) => {
    if (!shouldCapture(error)) return;
    reporter.capture(error, {
      requestId: req.id,
      userId: userIdOf(req),
      firmId: firmIdOf(req),
      route: routeOf(req),
      method: req.method,
    });
  });

  app.addHook("onResponse", async (req, reply) => {
    const route = routeOf(req);
    const ms = durationMs(req);
    recordRequest({
      route,
      method: req.method,
      statusCode: reply.statusCode,
      durationMs: ms,
    });
    for (const alert of metricAlerts())
      req.log.warn({ ...alert, requestId: req.id }, "Metric alert");
    req.log.info(
      {
        requestId: req.id,
        userId: userIdOf(req),
        firmId: firmIdOf(req),
        route,
        method: req.method,
        statusCode: reply.statusCode,
        durationMs: Number(ms.toFixed(2)),
      },
      "Request completed",
    );
  });

  app.get("/metrics", async (_req, reply) =>
    reply.type("text/plain; version=0.0.4").send(metricsText()),
  );
}
