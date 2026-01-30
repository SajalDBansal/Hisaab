import * as Sentry from "@sentry/node";
import type { FastifyBaseLogger } from "fastify";

export type ErrorReporter = {
  capture: (error: unknown, context: Record<string, unknown>) => void;
};

export type ErrorReporterOptions = {
  dsn?: string;
  environment: string;
  release?: string;
  service: string;
  tracesSampleRate: number;
};

let sentryStarted = false;

export function logErrorReporter(log: FastifyBaseLogger): ErrorReporter {
  return {
    capture(error, context) {
      log.error({ err: error, ...context }, "Captured error");
    },
  };
}

function startSentry(options: ErrorReporterOptions) {
  if (!options.dsn || sentryStarted) return;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release || undefined,
    tracesSampleRate: options.tracesSampleRate,
    serverName: options.service,
  });
  sentryStarted = true;
}

export function createErrorReporter(
  log: FastifyBaseLogger,
  options: ErrorReporterOptions,
): ErrorReporter {
  const fallback = logErrorReporter(log);
  startSentry(options);
  if (!options.dsn) return fallback;
  return {
    capture(error, context) {
      Sentry.withScope((scope) => {
        scope.setTag("service", options.service);
        if (typeof context.requestId === "string")
          scope.setTag("requestId", context.requestId);
        if (typeof context.route === "string")
          scope.setTag("route", context.route);
        scope.setExtras(context);
        Sentry.captureException(error);
      });
      log.error({ err: error, ...context }, "Captured error");
    },
  };
}

export function installProcessErrorHandlers(
  log: FastifyBaseLogger,
  service: string,
  reporter: ErrorReporter = logErrorReporter(log),
) {
  process.on("unhandledRejection", (reason) => {
    reporter.capture(reason, { service, kind: "unhandledRejection" });
  });

  process.on("uncaughtException", (error) => {
    reporter.capture(error, { service, kind: "uncaughtException" });
    process.exit(1);
  });
}
