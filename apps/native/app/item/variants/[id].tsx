import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import {
  checkVariantAttributes,
  cleanVariantAttributes,
  missingVariants,
  variantName,
  type ItemDetail,
  type VariantAttribute,
} from "@repo/core";
import {
  Button,
  FooterBar,
  Header,
  IconButton,
  Notice,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
  showToast,
} from "@/components";
import { useMakeVariants } from "@/data/catalogHooks";
import { useItem, useItems } from "@/data/queries";
import { space } from "@/theme";

/** Item variants (doc 37, T35): attributes and values; one item per combination. */
export default function VariantsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useItem(id);
  return <QueryView query={item}>{(d) => <VariantsForm d={d} />}</QueryView>;
}

interface Draft {
  name: string;
  /** Comma-separated values, e.g. "S, M, L". */
  values: string;
}

function VariantsForm({ d }: { d: ItemDetail }) {
  const { item } = d;
  const existing = item.variantAttributes ?? [];
  const [drafts, setDrafts] = useState<Draft[]>(
    existing.length
      ? existing.map((a) => ({ name: a.name, values: a.values.join(", ") }))
      : [
          { name: "Size", values: "" },
          { name: "Colour", values: "" },
        ],
  );
  const items = useItems();
  const make = useMakeVariants();
  const attributes: VariantAttribute[] = cleanVariantAttributes(
    drafts.map((a) => ({ name: a.name, values: a.values.split(",") })),
  ).filter((a) => a.values.length);
  const problem = checkVariantAttributes(
    attributes,
    existing.length ? existing : undefined,
  );
  const children = (items.data ?? [])
    .map((r) => r.item)
    .filter((i) => i.parentId === item.id);
  const toMake = problem ? [] : missingVariants(attributes, children);
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const submit = async () => {
    try {
      const made = await make.mutateAsync({
        parentId: item.id,
        attributes,
        version: item.version,
      });
      showToast(
        `${made.created.length} variant${made.created.length === 1 ? "" : "s"} made`,
        "ok",
      );
      router.replace(`/item/${item.id}`);
    } catch (e) {
      showError("Couldn't make the variants", e);
    }
  };

  return (
    <Screen
      header={<Header close title="Variants" subtitle={item.name} />}
      footer={
        <FooterBar>
          <Txt variant="caption" tone="body" style={{ flex: 1 }}>
            {problem ??
              (toMake.length
                ? `${toMake.length} new item${toMake.length === 1 ? "" : "s"}`
                : "No new combinations")}
          </Txt>
          <Button
            label="Make variants"
            variant="primary"
            disabled={!!problem || !toMake.length}
            loading={make.isPending}
            onPress={() => void submit()}
          />
        </FooterBar>
      }
    >
      <Txt tone="body">
        Each combination becomes its own item with its own code, price and
        stock, named like{" "}
        {variantName(item.name, [{ name: "Size", value: "M" }])}. They start
        with this item&apos;s prices and GST; edit any of them later.
        {existing.length
          ? " Attributes stay as they are; add values to make more."
          : " This item then holds no stock and is not billed itself."}
      </Txt>
      {drafts.map((a, i) => (
        <View key={i} style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <TextField
                label={`Attribute ${i + 1}`}
                value={a.name}
                onChangeText={(name) => update(i, { name })}
                editable={!existing[i]}
                maxLength={20}
              />
            </View>
            {!existing[i] && drafts.length > 1 ? (
              <IconButton
                icon="trash-2"
                label={`Remove ${a.name || "attribute"}`}
                onPress={() =>
                  setDrafts((prev) => prev.filter((_, j) => j !== i))
                }
              />
            ) : null}
          </View>
          <TextField
            label="Values, separated by commas"
            value={a.values}
            onChangeText={(values) => update(i, { values })}
            placeholder={i === 0 ? "S, M, L, XL" : "Red, Blue"}
          />
        </View>
      ))}
      {!existing.length && drafts.length < 3 ? (
        <Button
          label="Add an attribute"
          icon="plus"
          size="sm"
          onPress={() =>
            setDrafts((prev) => [...prev, { name: "", values: "" }])
          }
        />
      ) : null}
      {toMake.length ? (
        <Notice
          tone="info"
          text={`New: ${toMake
            .slice(0, 6)
            .map((v) => v.map((x) => x.value).join(" / "))
            .join(
              ", ",
            )}${toMake.length > 6 ? ` and ${toMake.length - 6} more` : ""}`}
        />
      ) : null}
    </Screen>
  );
}
