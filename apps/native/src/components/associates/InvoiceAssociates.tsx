import { useState } from "react";
import { View } from "react-native";
import type {
  InvoiceAssociatesInput,
  DeliverySnapshot,
  CommissionSnapshot,
} from "@repo/contracts/src/associates";
import { Button, PickerSheet, SelectField, TextField, Txt } from "@/components";
import {
  useAssociateAccess,
  useAssociateOptions,
  useAssociates,
} from "@/data/associateHooks";
import { space } from "@/theme";

/** Parent keeps this selection in its invoice draft and passes it to the API unchanged. */
export function InvoiceAssociates({
  value,
  onChange,
  saved,
  commissionEnabled = true,
}: {
  value: InvoiceAssociatesInput;
  onChange: (value: InvoiceAssociatesInput) => void;
  saved?: { delivery?: DeliverySnapshot; commission?: CommissionSnapshot };
  commissionEnabled?: boolean;
}) {
  const access = useAssociateAccess();
  const options = useAssociateOptions();
  const profiles = useAssociates();
  const [picker, setPicker] = useState<"delivery" | "commission" | null>(null);
  const [rateText, setRateText] = useState(
    value.commission?.rate?.toString() ?? "",
  );
  if (!access.connected || !access.select) return null;
  const delivery =
    value.delivery === undefined ? saved?.delivery : value.delivery;
  const commission =
    value.commission === undefined ? saved?.commission : value.commission;
  const rule = profiles.data?.find(
    (p) => p.id === commission?.associateId,
  )?.commission;
  const nameOf = (id?: string, old?: { associateId: string; name: string }) =>
    options.data?.find((a) => a.id === id)?.name ??
    (old && old.associateId === id ? old.name : undefined);
  return (
    <View style={{ gap: space.md }}>
      <SelectField
        label="Delivery associate"
        value={nameOf(delivery?.associateId, saved?.delivery)}
        onPress={() => setPicker("delivery")}
      />
      {delivery ? (
        <>
          <TextField
            label="Delivery reference"
            value={delivery.reference}
            onChangeText={(reference) =>
              onChange({
                ...value,
                delivery: { associateId: delivery.associateId, reference },
              })
            }
            maxLength={100}
          />
          <Button
            label="Remove delivery assignment"
            icon="x"
            onPress={() => onChange({ ...value, delivery: null })}
          />
        </>
      ) : null}
      {access.write && commissionEnabled ? (
        <>
          <SelectField
            label="Commission partner"
            value={nameOf(commission?.associateId, saved?.commission)}
            onPress={() => setPicker("commission")}
          />
          {commission ? (
            <Button
              label="Remove commission partner"
              icon="x"
              onPress={() => onChange({ ...value, commission: null })}
            />
          ) : null}
          {saved?.commission && value.commission === undefined ? (
            <Txt variant="caption">
              Saved rate {saved.commission.rate}% | Rule{" "}
              {saved.commission.ruleVersion}
            </Txt>
          ) : null}
          {value.commission && rule ? (
            <Txt variant="caption">
              Default rate {rule.rate}% | Effective {rule.effectiveFrom}
            </Txt>
          ) : null}
          {value.commission && rule?.allowOverride ? (
            <TextField
              label="Override commission (%)"
              value={rateText}
              keyboardType="decimal-pad"
              onChangeText={(text) => {
                setRateText(text);
                onChange({
                  ...value,
                  commission: {
                    associateId: value.commission!.associateId,
                    ...(text.trim() ? { rate: Number(text) } : {}),
                  },
                });
              }}
            />
          ) : null}
        </>
      ) : null}
      {options.error ? (
        <Button
          label="Retry associates"
          icon="refresh-cw"
          onPress={() => void options.refetch()}
        />
      ) : null}
      <PickerSheet
        visible={!!picker}
        title={
          picker === "delivery" ? "Delivery associate" : "Commission partner"
        }
        options={(options.data ?? [])
          .filter((a) =>
            a.roles.includes(
              picker === "delivery" ? "delivery" : "commission-partner",
            ),
          )
          .map((a) => ({
            id: a.id,
            title: a.name,
            subtitle: picker === "delivery" ? a.vehicle : undefined,
          }))}
        onSelect={(associateId) => {
          onChange({
            ...value,
            ...(picker === "delivery"
              ? {
                  delivery: {
                    associateId,
                    reference: delivery?.reference ?? "",
                  },
                }
              : { commission: { associateId } }),
          });
          setRateText("");
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
