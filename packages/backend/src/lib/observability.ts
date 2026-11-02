import * as Sentry from "@sentry/node";
import type { FastifyBaseLogger } from "fastify";
import { safeError, safeErrorContext, safeException } from "./safe-error";

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
      log.error(
        { err: safeError(error), ...safeErrorContext(context) },
        "Captured error",
      );
    },
  };
}

type ReportingClient = Pick<
  typeof Sentry,
  "init" | "withScope" | "captureException"
>;

function startSentry(options: ErrorReporterOptions, client: ReportingClient) {
  if (!options.dsn || sentryStarted) return;
  client.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release || undefined,
    tracesSampleRate: options.tracesSampleRate,
    serverName: options.service,
    // Report only our sanitized events; automatic SQL/HTTP breadcrumbs can contain secrets.
    defaultIntegrations: false,
    maxBreadcrumbs: 0,
    beforeSend(event) {
      event.request = undefined;
      event.user = undefined;
      event.breadcrumbs = [];
      event.contexts = undefined;
      event.tags = safeErrorContext(event.tags ?? {});
      const extra = event.extra ?? {};
      event.extra = {
        ...safeErrorContext(extra),
        error: safeError(extra.error),
      };
      return event;
    },
  });
  sentryStarted = true;
}

export function createErrorReporter(
  log: FastifyBaseLogger,
  options: ErrorReporterOptions,
  client: ReportingClient = Sentry,
): ErrorReporter {
  const fallback = logErrorReporter(log);
  startSentry(options, client);
  if (!options.dsn) return fallback;
  return {
    capture(error, context) {
      const safeContext = safeErrorContext(context);
      client.withScope((scope) => {
        scope.setTag("service", options.service);
        if (safeContext.requestId)
          scope.setTag("requestId", safeContext.requestId);
        if (safeContext.route) scope.setTag("route", safeContext.route);
        scope.setExtras({ ...safeContext, error: safeError(error) });
        client.captureException(safeException(error));
      });
      fallback.capture(error, safeContext);
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
