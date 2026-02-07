import { createHash } from "node:crypto";
import { can, type Role } from "@repo/core";
import { associatePayloadForRead } from "@repo/core/src/accounting/associates";
import { AppError } from "@repo/backend/lib/app-error";
import {
  OperationInput,
  OperationParams,
  type OperationResult,
  operationDefinition,
} from "./operations.schema";

export type OperationActor = {
  id: string;
  name: string;
  firmId: string;
  role: Role;
};
export type OperationReceipt = {
  firmId: string | null;
  role: string | null;
  requestHash: string;
  legacy: number;
  result: OperationResult;
};
export interface OperationTransaction {
  read(key: string): Promise<OperationReceipt | undefined>;
  save(key: string, receipt: OperationReceipt): Promise<void>;
  apply(input: OperationInput): Promise<unknown>;
  current(input: OperationInput): Promise<unknown>;
}
export interface OperationRepository {
  transaction<T>(
    actor: OperationActor,
    work: (tx: OperationTransaction) => Promise<T>,
  ): Promise<T>;
}
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stable(item)]),
        )
      : value;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const operationHash = (firmId: string, input: OperationInput) =>
  digest(
    stable([
      firmId,
      input.method,
      input.path,
      input.body,
      input.expectedVersion ?? null,
    ]),
  );
export const legacyHashes = (firmId: string, input: OperationInput) =>
  [input.path, `/v1${input.path}`, `POST /v1${input.path}`].map((path) =>
    digest([firmId, path, input.body]),
  );

export function createOperationEngine(repository: OperationRepository) {
  async function run(
    actor: OperationActor,
    key: string,
    raw: OperationInput,
    action: "execute" | "lookup" | "cancel",
  ): Promise<OperationResult> {
    OperationParams.parse({ key });
    const input = OperationInput.parse(raw);
    const definition = operationDefinition(input);
    if (!definition)
      throw new AppError(
        "UNSUPPORTED_OPERATION",
        "This operation cannot be queued.",
        400,
      );
    if (
      input.role !== actor.role ||
      !definition.permissions.some((permission) => can(actor.role, permission))
    )
      throw new AppError(
        "FORBIDDEN",
        "The original role and current permission are required to recover this operation.",
        403,
      );
    // The same contract validation runs for online writes and durable operations.
    input.body = definition.schema.parse(input.body) as Record<string, unknown>;
    const hash = operationHash(actor.firmId, input);
    const answer = await repository.transaction<OperationResult>(
      actor,
      async (tx) => {
        const found = await tx.read(key);
        if (found) {
          const matches = found.legacy
            ? input.method === "POST" &&
              legacyHashes(actor.firmId, input).includes(found.requestHash)
            : found.firmId === actor.firmId &&
              found.role === actor.role &&
              found.requestHash === hash;
          if (!matches)
            throw new AppError(
              "KEY_REUSED",
              "This operation key belongs to a different request or scope.",
              422,
            );
          return found.result.state === "conflict" && action === "lookup"
            ? { ...found.result, current: await tx.current(input) }
            : found.result;
        }
        if (input.legacy)
          return {
            state: "unknown",
            message:
              "No retained answer exists for this legacy request. Its result cannot be inferred and it will not be posted again.",
          };
        if (action === "lookup") return { state: "absent" };
        let result: OperationResult;
        if (action === "cancel") result = { state: "cancelled" };
        else {
          try {
            result = { state: "committed", response: await tx.apply(input) };
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              ![400, 404, 409, 422].includes(error.status)
            )
              throw error;
            result = {
              state: "conflict",
              code: error.code,
              message: error.message,
              current: await tx.current(input),
              ...(error.fields ? { fields: error.fields } : {}),
            };
          }
        }
        await tx.save(key, {
          firmId: actor.firmId,
          role: actor.role,
          requestHash: hash,
          legacy: 0,
          result,
        });
        return result;
      },
    );
    return associatePayloadForRead(actor.role, answer);
  }
  return {
    execute: (actor: OperationActor, key: string, input: OperationInput) =>
      run(actor, key, input, "execute"),
    lookup: (actor: OperationActor, key: string, input: OperationInput) =>
      run(actor, key, input, "lookup"),
    cancel: (actor: OperationActor, key: string, input: OperationInput) =>
      run(actor, key, input, "cancel"),
  };
}
