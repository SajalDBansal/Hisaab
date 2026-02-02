import { useLocalSearchParams } from "expo-router";
import type { PartyType } from "@repo/core";
import { PartyForm } from "@/forms/PartyForm";

/** /party/new?type=supplier — `pick=1` when opened from a sale or purchase form. */
export default function NewPartyScreen() {
  const { type, pick } = useLocalSearchParams<{
    type?: PartyType;
    pick?: string;
  }>();
  return (
    <PartyForm
      type={type === "supplier" ? "supplier" : "customer"}
      pick={pick === "1"}
    />
  );
}
