import * as c from "@repo/contracts/src/loans";
import type { Client } from "./client";
import { matchVersion } from "./masterServices";

/** Mutations use POST so the shared durable pending-write transport retains retry keys. */
export function loanServices(client: Client) {
  return {
    list: () => client.pages("/loans", c.LoanSummary),
    get: (id: string) => client.request(`/loans/${id}`, c.LoanDetail),
    history: (id: string) => client.pages(`/loans/${id}/history`, c.LoanEvent),
    candidates: (id: string) =>
      client.pages(`/loans/${id}/repayment-journals`, c.LoanJournalCandidate),
    create: (input: c.LoanInput) =>
      client.request("/loans", c.LoanRecord, {
        body: c.LoanInput.parse(input),
      }),
    update: (id: string, input: c.LoanUpdate, version: number) =>
      client.request(`/loans/${id}/update`, c.LoanRecord, {
        body: c.LoanUpdate.parse(input),
        headers: matchVersion(version),
      }),
    addReference: (id: string, input: c.LoanReferenceInput, version: number) =>
      client.request(`/loans/${id}/references`, c.LoanRecord, {
        body: c.LoanReferenceInput.parse(input),
        headers: matchVersion(version),
      }),
    removeReference: (
      id: string,
      referenceId: string,
      reason: string,
      version: number,
    ) =>
      client.request(
        `/loans/${id}/references/${referenceId}/remove`,
        c.LoanRecord,
        {
          body: c.LoanReferenceRemoval.parse({ reason }),
          headers: matchVersion(version),
        },
      ),
  };
}
export type LoanService = ReturnType<typeof loanServices>;
