import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import type { ApiError } from "@repo/contracts";
import { AppError } from "@repo/backend/lib/app-error";
import { safeError } from "@repo/backend/lib/safe-error";
import { bookControlError } from "../lib/book-errors";

const body = (
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiError => ({ error: { code, message, ...(fields ? { fields } : {}) } });

/** One error handler for the whole app, so every failure has the same JSON shape. */
export function registerErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    reply
      .code(404)
      .send(body("NOT_FOUND", `There is no ${req.method} ${req.url}.`));
  });

  app.setErrorHandler((error: FastifyError, req, reply) => {
    const controlError = bookControlError(error);
    if (controlError)
      return reply
        .code(controlError.status)
        .send(body(controlError.code, controlError.message));
    if (error instanceof AppError) {
      return reply
        .code(error.status)
        .send(body(error.code, error.message, error.fields));
    }

    // Wrong or missing fields in the request: say which field and why
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields: Record<string, string> = {};
      for (const issue of error.validation) {
        const path = issue.instancePath.replace(/^\//, "").replaceAll("/", ".");
        fields[path || "body"] ??= issue.message ?? "Not valid.";
      }
      return reply
        .code(400)
        .send(
          body("INVALID_INPUT", "Please check the highlighted fields.", fields),
        );
    }

    // Errors Fastify raises itself (bad JSON, body too large, rate limit...)
    const status =
      "statusCode" in error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status < 500) {
      return reply.code(status).send(body("BAD_REQUEST", error.message));
    }

    // Keep useful error codes without copying SQL parameters into diagnostics.
    req.log.error({ err: safeError(error) }, "Unhandled error");
    return reply
      .code(500)
      .send(
        body(
          "SERVER_ERROR",
          "Something went wrong on our side. Please try again.",
        ),
      );
  });
}
