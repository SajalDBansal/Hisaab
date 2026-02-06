import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  IMPORT_PREVIEW_SECONDS,
  ImportKind,
} from "@repo/contracts/src/imports";
import { AppError } from "@repo/backend/lib/app-error";

const Claims = z
  .object({
    v: z.literal(1),
    id: z.uuid(),
    firmId: z.uuid(),
    userId: z.uuid(),
    kind: ImportKind,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    expires: z.number().int(),
  })
  .strict();
export const importHash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export function importTokens(secret: string) {
  if (secret.length < 32)
    throw new Error(
      "Import preview signing requires a server secret of at least 32 characters.",
    );
  const sign = (payload: string) =>
    createHmac("sha256", secret).update(`master-import-v1:${payload}`).digest();
  return {
    issue(
      scope: {
        firmId: string;
        userId: string;
        kind: z.infer<typeof ImportKind>;
        hash: string;
        digest?: string;
      },
      now = Date.now(),
    ) {
      const claims = Claims.parse({
        ...scope,
        v: 1,
        id: randomUUID(),
        expires: now + IMPORT_PREVIEW_SECONDS * 1000,
      });
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return {
        token: `${payload}.${sign(payload).toString("base64url")}`,
        expiresAt: new Date(claims.expires).toISOString(),
      };
    },
    verify(
      token: string,
      scope: { firmId: string; userId: string; kind: string; hash: string },
    ) {
      try {
        if (
          token.length > 2048 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
        )
          throw new Error();
        const [payload = "", signature = ""] = token.split(".");
        const actual = Buffer.from(signature, "base64url");
        const expected = sign(payload);
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new Error();
        const claims = Claims.parse(
          JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
        if (
          claims.firmId !== scope.firmId ||
          claims.userId !== scope.userId ||
          claims.kind !== scope.kind ||
          claims.hash !== scope.hash
        )
          throw new Error();
        // Expiry is checked after durable replay lookup so lost responses remain recoverable.
        return claims;
      } catch {
        throw new AppError(
          "IMPORT_PREVIEW_INVALID",
          "Preview this CSV again before confirming the import.",
          422,
        );
      }
    },
  };
}
