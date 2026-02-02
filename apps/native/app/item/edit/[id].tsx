import { useLocalSearchParams } from "expo-router";
import { Header, QueryView, Screen } from "@/components";
import { useItem } from "@/data/queries";
import { ItemForm } from "@/forms/ItemForm";

export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useItem(id);
  if (detail.data)
    return (
      <ItemForm
        item={detail.data.item}
        used={detail.data.movements.length > 0}
      />
    );
  return (
    <Screen header={<Header close title="Edit item" />}>
      <QueryView query={detail}>{() => null}</QueryView>
    </Screen>
  );
}
