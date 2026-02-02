import { useLocalSearchParams } from "expo-router";
import { Header, QueryView, Screen } from "@/components";
import { useParty } from "@/data/queries";
import { PartyForm } from "@/forms/PartyForm";

export default function EditPartyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useParty(id);
  if (detail.data)
    return (
      <PartyForm
        party={detail.data.party}
        typeLocked={detail.data.transactions.length > 0}
      />
    );
  return (
    <Screen header={<Header close title="Edit party" />}>
      <QueryView query={detail}>{() => null}</QueryView>
    </Screen>
  );
}
