import {
  BATCH_EXCLUDED_PATH,
  BATCH_READABLE_PATH,
  BatchReadInput,
  BatchReadResult,
  RECOVERY_EPOCH_HEADER,
} from "@repo/contracts";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { withSharedReportBooks } from "@repo/backend/modules/reports/books";
import { BATCH_READ_HEADER, BATCH_READ_TOKEN } from "../../lib/batch-read";

/** Who is asking: the batch's own identity, firm and client, nothing else. */
const FORWARDED = [
  "cookie",
  "authorization",
  "x-firm-id",
  "x-platform",
  "x-device-name",
  "origin",
  "expo-origin",
  RECOVERY_EPOCH_HEADER.toLowerCase(),
];

/**
 * Answers up to 200 book reads in one request (offline downloads). Each path
 * runs through its normal route in-process, so authentication, the firm and
 * role checks, validation and the response shape are exactly those of a single
 * request; the firm's books are read once and shared by the whole batch.
 */
export async function readRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/reads/batch",
    {
      preHandler: app.inFirm(),
      config: { readOnly: true },
      schema: { body: BatchReadInput, response: { 200: BatchReadResult } },
    },
    async (req) => {
      const headers: Record<string, string> = {
        [BATCH_READ_HEADER]: BATCH_READ_TOKEN,
      };
      for (const name of FORWARDED) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const results = await withSharedReportBooks(async () => {
        const answers: BatchReadResult["results"] = [];
        // One at a time: the shared books and the database pool stay predictable.
        for (const path of req.body.paths) {
          if (
            !BATCH_READABLE_PATH.test(path) ||
            BATCH_EXCLUDED_PATH.test(path)
          ) {
            answers.push({
              path,
              status: 400,
              format: "json",
              body: {
                error: {
                  code: "NOT_BATCHABLE",
                  message: "This read can't be part of a batch.",
                },
              },
            });
            continue;
          }
          const reply = await app.inject({ method: "GET", url: path, headers });
          const json = /json/.test(String(reply.headers["content-type"] ?? ""));
          answers.push({
            path,
            status: reply.statusCode,
            format: json ? "json" : "text",
            body: json && reply.body ? JSON.parse(reply.body) : reply.body,
          });
        }
        return answers;
      });
      return { results };
    },
  );
}
