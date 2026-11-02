/**
 * The firm's GST setting, used when creating a firm and in Firm profile:
 *   [x] GST registered   → Regular or Composition (+ business type) and the GSTIN
 *   [ ] GST registered   → GST is switched off: no GST rates, HSN, GSTINs or GST reports.
 */
import { View } from "react-native";
import {
  COMPOSITION_TYPES,
  GST_MODES,
  type CompositionType,
  type GstRegistration,
} from "@repo/core";
import { Checkbox, Chip, Segmented, TextField, Txt } from "@/components";
import { space } from "@/theme";

export interface GstSettingValue {
  gstRegistration: GstRegistration;
  compositionType?: CompositionType;
  gstin: string;
}

export function GstSettingFields({
  value,
  onChange,
  gstinError,
  onGstinChange,
}: {
  value: GstSettingValue;
  onChange: (v: GstSettingValue) => void;
  gstinError?: string;
  /** Called with the typed GSTIN (e.g. to fill the state from it). */
  onGstinChange?: (gstin: string) => void;
}) {
  const on = value.gstRegistration !== "unregistered";
  const scheme = on ? value.gstRegistration : "regular";
  const set = (patch: Partial<GstSettingValue>) =>
    onChange({ ...value, ...patch });

  return (
    <View style={{ gap: space.md }}>
      <Checkbox
        label="GST registered"
        note={
          on
            ? "GST rates, HSN and GST reports are used for this firm."
            : "GST is switched off: no GST rates, HSN, GSTINs or GST reports. Billing, stock, payments and accounts work the same."
        }
        checked={on}
        onChange={(checked) =>
          set({
            gstRegistration: checked ? "regular" : "unregistered",
            compositionType: undefined,
          })
        }
      />
      {on ? (
        <>
          <View style={{ gap: 6 }}>
            <Txt variant="label" tone="charcoal">
              GST scheme
            </Txt>
            <Segmented
              value={scheme}
              onChange={(s) =>
                set({
                  gstRegistration: s,
                  compositionType:
                    s === "composition"
                      ? (value.compositionType ?? "trader")
                      : undefined,
                })
              }
              options={[
                { value: "regular", label: "Regular" },
                { value: "composition", label: "Composition" },
              ]}
            />
            <Txt variant="caption" tone="body">
              {GST_MODES.find((m) => m.value === scheme)?.note}
              {scheme === "composition"
                ? ". Bills become Bills of supply and you can't sell to other states."
                : "."}
            </Txt>
          </View>
          {scheme === "composition" ? (
            <View style={{ gap: 6 }}>
              <Txt variant="label" tone="charcoal">
                Business type (decides the composition rate)
              </Txt>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {COMPOSITION_TYPES.map((t) => (
                  <Chip
                    key={t.value}
                    label={`${t.label} · ${t.rate}%`}
                    selected={(value.compositionType ?? "trader") === t.value}
                    onPress={() => set({ compositionType: t.value })}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <TextField
            label="GSTIN"
            value={value.gstin}
            onChangeText={(t) => {
              const gstin = t
                .toUpperCase()
                .replace(/[^0-9A-Z]/g, "")
                .slice(0, 15);
              set({ gstin });
              onGstinChange?.(gstin);
            }}
            placeholder="09AAAAA0000A1Z0"
            mono
            error={gstinError}
          />
        </>
      ) : null}
    </View>
  );
}
