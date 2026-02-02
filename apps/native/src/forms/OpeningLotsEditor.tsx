import { View } from "react-native";
import * as Crypto from "expo-crypto";
import type { BookScope, OpeningStockLot } from "@repo/core";
import { parseRupees } from "@repo/core";
import {
  AmountField,
  Button,
  IconButton,
  Segmented,
  TextField,
} from "@/components";
import { space } from "@/theme";

export interface OpeningLotDraft {
  id: string;
  qty: string;
  cost: string;
  bookScope: BookScope;
}
export const openingLotDrafts = (
  lots: OpeningStockLot[] = [],
): OpeningLotDraft[] =>
  lots.map((lot) => ({
    id: lot.id,
    qty: String(lot.qty),
    cost: String(lot.unitCost / 100),
    bookScope: lot.bookScope,
  }));
export const openingLotsInput = (rows: OpeningLotDraft[]): OpeningStockLot[] =>
  rows.map((row) => ({
    id: row.id,
    qty: Number(row.qty),
    unitCost: parseRupees(row.cost) ?? -1,
    bookScope: row.bookScope,
  }));

export function OpeningLotsEditor({
  rows,
  onChange,
  disabled,
}: {
  rows: OpeningLotDraft[];
  onChange: (rows: OpeningLotDraft[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<OpeningLotDraft>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <View style={{ gap: space.md }}>
      {rows.map((row, index) => (
        <View key={row.id} style={{ gap: space.sm }}>
          <Segmented
            value={row.bookScope}
            onChange={(value) => {
              if (!disabled) update(index, { bookScope: value });
            }}
            options={[
              { value: "gst", label: "GST" },
              { value: "nongst", label: "Non-GST" },
            ]}
          />
          <View
            style={{
              flexDirection: "row",
              gap: space.sm,
              alignItems: "center",
            }}
          >
            <TextField
              label={`Lot ${index + 1} quantity`}
              value={row.qty}
              onChangeText={(qty) => update(index, { qty })}
              keyboardType="decimal-pad"
              editable={!disabled}
            />
            <AmountField
              label="Unit cost"
              value={row.cost}
              onChangeText={(cost) => update(index, { cost })}
              editable={!disabled}
            />
            {!disabled ? (
              <IconButton
                icon="trash-2"
                label="Remove opening lot"
                onPress={() => onChange(rows.filter((_, i) => i !== index))}
              />
            ) : null}
          </View>
        </View>
      ))}
      {!disabled ? (
        <Button
          label="Add opening lot"
          icon="plus"
          onPress={() =>
            onChange([
              ...rows,
              { id: Crypto.randomUUID(), qty: "", cost: "", bookScope: "gst" },
            ])
          }
        />
      ) : null}
    </View>
  );
}
