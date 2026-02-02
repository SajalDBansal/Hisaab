import { useLocalSearchParams } from "expo-router";
import { ItemForm } from "@/forms/ItemForm";

/** /item/new — `pick=1` when opened from a sale or purchase form. */
export default function NewItemScreen() {
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  return <ItemForm pick={pick === "1"} />;
}
