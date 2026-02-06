import {
  ImportApplyInput,
  ImportApplyResponse,
  ImportKind,
  ImportPreview,
  ImportPreviewInput,
  ImportRequestHeaders,
  ImportTemplate,
} from "@repo/contracts/src/imports";
import { type Client, queryString } from "./client";

export function importServices(client: Client) {
  return {
    template: (kind: ImportKind) =>
      client.request(
        `/imports/template${queryString({ kind: ImportKind.parse(kind) })}`,
        ImportTemplate,
      ),
    preview: (input: ImportPreviewInput) =>
      client.request("/imports/preview", ImportPreview, {
        body: ImportPreviewInput.parse(input),
      }),
    apply: (input: ImportApplyInput, requestKey: string) =>
      client.request("/imports/apply", ImportApplyResponse, {
        body: ImportApplyInput.parse(input),
        headers: ImportRequestHeaders.parse({ "idempotency-key": requestKey }),
      }),
  };
}
export type ImportService = ReturnType<typeof importServices>;

/** Fail closed for providers without the import capability, including demo mode. */
export function importServiceFrom(services: object): ImportService {
  const service = (services as { importService?: ImportService }).importService;
  if (!service) throw new Error("Imports are not connected to this session.");
  return service;
}
