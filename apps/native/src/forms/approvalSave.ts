import { router } from "expo-router";
import type { ApprovalType } from "@repo/contracts";
import { showToast } from "@/components";
import { useNeedsApproval, useSubmitEntry } from "@/data/recurringHooks";

/**
 * Approvals (doc 37, T06): when this person's entries of this type need
 * approval, the form sends the entry for approval instead of saving it.
 */
export function useApprovalSave(type: ApprovalType) {
  const waits = useNeedsApproval(type);
  const submit = useSubmitEntry();
  return {
    waits,
    busy: submit.isPending,
    /** Sends and opens the entry when it must wait; false when it posts directly. */
    async send(input: object) {
      if (!waits) return false;
      const entry = await submit.mutateAsync({
        type,
        input: input as Record<string, unknown>,
      });
      showToast("Sent for approval");
      router.replace(`/entries/${entry.id}`);
      return true;
    },
  };
}
