import { useQueryClient } from "@tanstack/react-query";
import type {
  ImportApplyInput,
  ImportKind,
  ImportPreviewInput,
} from "@repo/contracts/src/imports";
import { useData } from "./DataProvider";
import { importServiceFrom } from "./importServices";
import { useServiceMutation } from "./scopedHooks";

export function useMasterImports() {
  const { userId, firmId, role } = useData();
  const cache = useQueryClient();
  const allowed =
    userId !== "demo" &&
    !!firmId &&
    (role === "owner" || role === "accountant");
  const checkAccess = () => {
    if (!allowed)
      throw new Error(
        "Sign in as the firm's owner or accountant to import masters.",
      );
  };
  const template = useServiceMutation({
    mutationFn: (services, kind: ImportKind) => {
      checkAccess();
      return importServiceFrom(services).template(kind);
    },
  });
  const preview = useServiceMutation({
    mutationFn: (services, input: ImportPreviewInput) => {
      checkAccess();
      return importServiceFrom(services).preview(input);
    },
  });
  const apply = useServiceMutation({
    mutationFn: async (
      services,
      input: { body: ImportApplyInput; requestKey: string },
    ) => {
      checkAccess();
      const response = await importServiceFrom(services).apply(
        input.body,
        input.requestKey,
      );
      if (response.status === "applied")
        await cache.invalidateQueries({ queryKey: ["books", userId, firmId] });
      return response;
    },
  });
  return { allowed, template, preview, apply };
}
