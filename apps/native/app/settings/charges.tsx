import { useEffect, useState } from "react";
import { View } from "react-native";
import { can, type ChargeHead, type GstRate } from "@repo/core";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ChipRow,
  Header,
  IconButton,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useInvoiceSettings, useUpdateInvoiceSettings } from "@/data/queries";
import { useData } from "@/data/DataProvider";
import { space } from "@/theme";

const TREATMENTS: { value: ChargeHead["taxType"]; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "exempt", label: "Exempt" },
  { value: "nongst", label: "Non-GST" },
];
const RATES: GstRate[] = [5, 18, 40];

/** Charge heads (doc 37, T09): packing, insurance, loading and the like. */
export default function ChargeHeadsScreen() {
  const saved = useInvoiceSettings();
  return (
    <Screen
      header={
        <Header
          title="Charges on bills"
          subtitle="Packing, insurance, loading"
        />
      }
    >
      <QueryView query={saved}>
        {(s) => <Heads saved={s.chargeHeads ?? []} />}
      </QueryView>
    </Screen>
  );
}

function Heads({ saved }: { saved: ChargeHead[] }) {
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const save = useUpdateInvoiceSettings();
  const [heads, setHeads] = useState(saved);
  useEffect(() => setHeads(saved), [saved]);
  const patch = (id: string, change: Partial<ChargeHead>) =>
    setHeads((list) =>
      list.map((h) => (h.id === id ? { ...h, ...change } : h)),
    );
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="small" tone="body">
        Pick these on sale and purchase bills. Each bill keeps the GST and
        ledger it was saved with, so changing a charge here never changes old
        bills. Freight stays as its own field.
      </Txt>
      {heads.map((h) => (
        <Card key={h.id} style={{ gap: space.sm }}>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <TextField
              label="Name"
              value={h.name}
              editable={canEdit}
              maxLength={60}
              onChangeText={(name) => patch(h.id, { name })}
            />
            {canEdit && !saved.some((s) => s.id === h.id) ? (
              <IconButton
                icon="trash-2"
                label={`Remove ${h.name || "charge"}`}
                onPress={() =>
                  setHeads((list) => list.filter((x) => x.id !== h.id))
                }
              />
            ) : null}
          </View>
          <ChipRow>
            {TREATMENTS.map((t) => (
              <Chip
                key={t.value}
                label={t.label}
                selected={h.taxType === t.value}
                onPress={
                  canEdit
                    ? () =>
                        patch(h.id, {
                          taxType: t.value,
                          gstRate: t.value === "taxable" ? h.gstRate || 18 : 0,
                        })
                    : undefined
                }
              />
            ))}
          </ChipRow>
          {h.taxType === "taxable" ? (
            <ChipRow>
              {RATES.map((rate) => (
                <Chip
                  key={rate}
                  label={`GST ${rate}%`}
                  selected={h.gstRate === rate}
                  onPress={
                    canEdit ? () => patch(h.id, { gstRate: rate }) : undefined
                  }
                />
              ))}
            </ChipRow>
          ) : null}
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <TextField
              label="SAC"
              value={h.sac ?? ""}
              editable={canEdit}
              keyboardType="number-pad"
              maxLength={8}
              onChangeText={(sac) => patch(h.id, { sac: sac || undefined })}
            />
            <TextField
              label="Sales ledger"
              value={h.salesLedger ?? ""}
              placeholder={`${h.name || "Name"} Charged`}
              editable={canEdit}
              maxLength={60}
              onChangeText={(v) => patch(h.id, { salesLedger: v || undefined })}
            />
          </View>
          <TextField
            label="Purchase ledger"
            value={h.purchaseLedger ?? ""}
            placeholder={h.name || "Name"}
            editable={canEdit}
            maxLength={60}
            onChangeText={(v) =>
              patch(h.id, { purchaseLedger: v || undefined })
            }
          />
          <Checkbox
            label="Show on bills"
            checked={h.active}
            onChange={canEdit ? (active) => patch(h.id, { active }) : () => {}}
          />
        </Card>
      ))}
      {canEdit ? (
        <>
          <Button
            label="Add charge"
            icon="plus"
            onPress={() =>
              setHeads((list) => [
                ...list,
                {
                  id: `ch_${Date.now().toString(36)}`,
                  name: "",
                  taxType: "taxable",
                  gstRate: 18,
                  active: true,
                },
              ])
            }
          />
          <Button
            label="Save"
            icon="check"
            variant="primary"
            block
            disabled={JSON.stringify(heads) === JSON.stringify(saved)}
            loading={save.isPending}
            onPress={async () => {
              try {
                await save.mutateAsync({ chargeHeads: heads });
              } catch (e) {
                showError("Couldn't save", e);
              }
            }}
          />
        </>
      ) : null}
    </View>
  );
}
