const ERROR_TYPES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "AggregateError",
  "AppError",
  "APIError",
  "ZodError",
  "DrizzleQueryError",
  "DatabaseError",
  "PostgresError",
  "AbortError",
  "TimeoutError",
]);
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENOSPC",
  "EACCES",
  "ENOENT",
  "ABORT_ERR",
]);
const CONTEXT_KEYS = [
  "requestId",
  "userId",
  "firmId",
  "jobId",
  "queue",
  "service",
  "kind",
  "route",
  "method",
] as const;

export type SafeError = {
  type: string;
  message: string;
  stack: string;
  code?: string;
  status?: number;
  cause?: SafeError;
  errors?: SafeError[];
};

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

// Error messages/stacks may embed SQL parameters; redact by omission, not by guessing secrets.
export function safeError(error: unknown): SafeError {
  const seen = new Set<unknown>();
  function visit(value: unknown, depth: number): SafeError {
    const source = fields(value);
    const name = source.name ?? source.type;
    const type =
      typeof name === "string" && ERROR_TYPES.has(name) ? name : "Error";
    const result: SafeError = {
      type,
      message: "Operation failed; details withheld.",
      stack: "",
    };
    if (depth >= 4 || seen.has(value)) return result;
    seen.add(value);
    const code = source.code;
    // SQLSTATE and known transport codes describe failures without including bound values.
    if (
      typeof code === "string" &&
      (/^[0-9A-Z]{5}$/.test(code) || NETWORK_CODES.has(code))
    )
      result.code = code;
    const status = source.status ?? source.statusCode;
    if (
      Number.isInteger(status) &&
      Number(status) >= 100 &&
      Number(status) <= 599
    )
      result.status = Number(status);
    if (source.cause) result.cause = visit(source.cause, depth + 1);
    if (Array.isArray(source.errors))
      result.errors = source.errors
        .slice(0, 5)
        .map((nested) => visit(nested, depth + 1));
    return result;
  }
  return visit(error, 0);
}

// Only correlation fields belong in diagnostics; request bodies and financial values do not.
export function safeErrorContext(context: Record<string, unknown>) {
  const safe: Record<string, string> = {};
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (
      typeof value === "string" &&
      value.length <= 200 &&
      !/[\r\n\0]/.test(value)
    )
      safe[key] = value;
  }
  return safe;
}

// Never give reporting SDKs an original exception or its nested causes.
export function safeException(error: unknown) {
  const safe = safeError(error);
  const exception = new Error(safe.message);
  exception.name = safe.type;
  exception.stack = `${safe.type}: ${safe.message}`;
  return exception;
}
