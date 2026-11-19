/**
 * Subtotal discount and charge heads on the bill form (doc 37, T09).
 * Kept apart from InvoiceForm: it only edits text; the form does the maths.
 */
import { View } from "react-native";
import type { ChargeHead, ExtraCharge } from "@repo/core";
import {
  AmountField,
  Chip,
  ChipRow,
  IconButton,
  Segmented,
  TextField,
  Txt,
} from "@/components";
import { space } from "@/theme";

const treatment = (h: Pick<ChargeHead, "taxType" | "gstRate">) =>
  h.taxType === "exempt"
    ? "exempt"
    : h.taxType === "nongst"
      ? "non-GST"
      : `GST ${h.gstRate}%`;

export function InvoiceExtras({
  heads,
  saved,
  amounts,
  onAmounts,
  carriesGst,
  discountIn,
  onDiscountIn,
  discountText,
  onDiscountText,
}: {
  heads: ChargeHead[];
  /** Charges already on the bill being edited (their frozen GST wins). */
  saved: ExtraCharge[];
  amounts: Record<string, string>;
  onAmounts: (next: Record<string, string>) => void;
  carriesGst: boolean;
  discountIn: "percent" | "amount";
  onDiscountIn: (v: "percent" | "amount") => void;
  discountText: string;
  onDiscountText: (v: string) => void;
}) {
  const label = (id: string) => {
    const frozen = saved.find((c) => c.headId === id);
    const head = heads.find((h) => h.id === id);
    const name = frozen?.name ?? head?.name ?? "Charge";
    const tax = frozen
      ? treatment({
          taxType:
            frozen.taxType === "exempt" || frozen.taxType === "nongst"
              ? frozen.taxType
              : "taxable",
          gstRate: frozen.gstRate,
        })
      : head
        ? treatment(head)
        : "";
    return carriesGst && tax ? `${name} ₹ (${tax})` : `${name} ₹`;
  };
  const added = Object.keys(amounts);
  const choices = heads.filter((h) => h.active && !added.includes(h.id));
  return (
    <View style={{ gap: space.sm }}>
      {added.map((id) => (
        <View
          key={id}
          style={{
            flexDirection: "row",
            gap: space.sm,
            alignItems: "flex-end",
          }}
        >
          <AmountField
            label={label(id)}
            value={amounts[id]}
            onChangeText={(text) => onAmounts({ ...amounts, [id]: text })}
          />
          <IconButton
            icon="x"
            label="Remove charge"
            onPress={() => {
              const next = { ...amounts };
              delete next[id];
              onAmounts(next);
            }}
          />
        </View>
      ))}
      {choices.length ? (
        <View style={{ gap: space.xs }}>
          <Txt variant="small" tone="body">
            Add a charge
          </Txt>
          <ChipRow>
            {choices.map((h) => (
              <Chip
                key={h.id}
                label={`+ ${h.name}`}
                onPress={() => onAmounts({ ...amounts, [h.id]: "" })}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <View style={{ gap: space.xs }}>
        <Txt variant="small" tone="body">
          Discount on the subtotal
        </Txt>
        <View
          style={{
            flexDirection: "row",
            gap: space.sm,
            alignItems: "flex-end",
          }}
        >
          <View style={{ width: 120 }}>
            <Segmented
              value={discountIn}
              onChange={(v) => {
                onDiscountIn(v);
                onDiscountText("");
              }}
              options={[
                { value: "percent", label: "%" },
                { value: "amount", label: "₹" },
              ]}
            />
          </View>
          {discountIn === "percent" ? (
            <TextField
              label="Discount %"
              value={discountText}
              keyboardType="decimal-pad"
              onChangeText={(d) => onDiscountText(d.replace(/[^0-9.]/g, ""))}
            />
          ) : (
            <AmountField
              label="Discount ₹"
              value={discountText}
              onChangeText={onDiscountText}
            />
          )}
        </View>
        {carriesGst && discountText ? (
          <Txt variant="caption" tone="body">
            Spread over the items by value; GST is on the discounted value.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
