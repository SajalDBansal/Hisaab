import { APIError } from "better-auth/api";
import { AppError } from "@repo/backend/lib/app-error";

// Better Auth words some errors for developers; the shop owner sees these instead
const FRIENDLY: Record<string, string> = {
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION:
    "This person is already in your team.",
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION:
    "This person has already been invited.",
  INVITATION_NOT_FOUND: "That invitation was not found or has expired.",
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    "This invitation was sent to a different email address.",
  MEMBER_NOT_FOUND: "That team member was not found.",
};

/** Runs a Better Auth call and turns its failure into our standard error. */
export async function viaAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof APIError) {
      const body = err.body as { code?: string; message?: string } | undefined;
      const code = body?.code ?? "REQUEST_FAILED";
      throw new AppError(
        code,
        FRIENDLY[code] ?? body?.message ?? err.message,
        err.statusCode,
      );
    }
    throw err;
  }
}
