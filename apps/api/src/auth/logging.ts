import { safeError } from "@repo/backend/lib/safe-error";

type AuthLog = {
  error: (fields: object, message: string) => void;
  warn?: (fields: object, message: string) => void;
};

// Better Auth's default logger prints raw adapter exceptions outside Fastify's serializers.
export function authLogger(log: AuthLog) {
  return {
    level: "warn" as const,
    log(
      level: "debug" | "info" | "warn" | "error",
      _message: string,
      ...args: unknown[]
    ) {
      const write =
        level === "warn" && log.warn ? log.warn.bind(log) : log.error.bind(log);
      write(
        { source: "auth", errors: args.map(safeError) },
        "Authentication diagnostic",
      );
    },
  };
}
