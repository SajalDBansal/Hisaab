import { createHash } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import { z } from "zod";
import type { Db } from "../../db/client";
import type { JobQueueClient, PdfJob } from "../../jobs/queues";
import { printVoucher } from "../vouchers/print";
import type { PdfStorage } from "./storage";

const Template = z.enum(["classic", "modern", "compact"]);
export type PdfInput = {
  firmId: string;
  voucherId: string;
  template?: z.infer<typeof Template>;
};

export const PdfResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    fileName: z.string(),
    url: z.string(),
    expiresAt: z.string(),
  }),
  z.object({
    status: z.enum(["queued", "processing", "failed"]),
    jobId: z.string(),
  }),
]);
export type PdfRenderer = (html: string, compact: boolean) => Promise<Buffer>;

async function artifact(db: Db, input: PdfInput) {
  const printable = await printVoucher(
    db,
    input.firmId,
    input.voucherId,
    input.template,
  );
  const revision = createHash("sha256")
    .update(JSON.stringify([1, printable.html, printable.fileName]))
    .digest("hex");
  return {
    ...printable,
    revision,
    key: `firms/${input.firmId}/generated-pdfs/${input.voucherId}/${revision}.pdf`,
  };
}

// Call only after the route's membership and voucher-read permission checks.
export async function requestVoucherPdf(
  ctx: { db: Db; jobs: JobQueueClient; storage: PdfStorage },
  input: PdfInput,
  options: { retryFailed?: boolean } = {},
): Promise<z.infer<typeof PdfResponse>> {
  const current = await artifact(ctx.db, input);
  if (await ctx.storage.exists(current.key))
    return {
      status: "ready",
      fileName: current.fileName,
      ...(await ctx.storage.download(current.key, current.fileName)),
    };

  const jobId = await ctx.jobs.add(
    "pdf",
    {
      kind: "render-voucher",
      ...input,
      revision: current.revision,
    },
    { ...options, retryCompleted: true },
  );
  const job = await ctx.jobs.get("pdf", jobId);
  return {
    jobId,
    status:
      job?.state === "failed"
        ? "failed"
        : job?.state === "active"
          ? "processing"
          : "queued",
  };
}

export async function renderVoucherPdf(
  ctx: { db: Db; storage: PdfStorage; render: PdfRenderer },
  job: PdfJob,
) {
  const template = Template.optional().safeParse(job.template);
  if (!template.success)
    throw new UnrecoverableError("Unknown invoice template.");
  const current = await artifact(ctx.db, { ...job, template: template.data });
  if (job.revision && job.revision !== current.revision)
    throw new UnrecoverableError(
      "The voucher changed. Request its current PDF.",
    );
  if (!(await ctx.storage.exists(current.key))) {
    const compact = /width=340/.test(current.html);
    await ctx.storage.put(current.key, await ctx.render(current.html, compact));
  }
  // Never persist a short-lived signed URL in Redis; each read signs a fresh URL.
  return {
    key: current.key,
    revision: current.revision,
    fileName: current.fileName,
  };
}
