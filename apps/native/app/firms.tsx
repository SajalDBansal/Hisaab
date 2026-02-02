import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { Pressable, View } from "react-native";
import {
  checkNewFirm,
  stateFromGstin,
  stateName,
  STATES,
  type FirmRow,
  gstModeLabel,
  gstModeOf,
  count,
} from "@repo/core";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Header,
  Icon,
  PickerSheet,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCreateFirm, useFirms, useSwitchFirm } from "@/data/queries";

import {
  GstSettingFields,
  type GstSettingValue,
} from "@/forms/GstSettingFields";
import { colors, radius, space } from "@/theme";

/** Every business this user keeps books for. Each firm has its own parties, items and vouchers. */
export default function FirmsScreen() {
  const firms = useFirms();
  const switchFirm = useSwitchFirm();
  const [adding, setAdding] = useState(false);

  const open = async (row: FirmRow) => {
    if (row.active) return backOrReplace(router);
    try {
      await switchFirm.mutateAsync(row.firm.id);
      router.dismissTo("/");
    } catch (e) {
      showError("Couldn't switch", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title={firms.data?.length === 0 ? "Create your firm" : "Switch firm"}
          subtitle="Each firm has its own books"
        />
      }
    >
      <QueryView query={firms}>
        {(rows) => (
          <View style={{ gap: space.sm }}>
            {rows.map((r) => (
              <Pressable
                key={r.firm.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: r.active }}
                accessibilityLabel={r.firm.name}
                disabled={switchFirm.isPending}
                onPress={() => open(r)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  padding: space.lg,
                  borderRadius: radius.card,
                  borderWidth: r.active ? 2 : 1,
                  borderColor: r.active ? colors.ink : colors.hairline,
                }}
              >
                <Avatar name={r.firm.name} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" style={{ fontWeight: "600" }}>
                    {r.firm.name}
                  </Txt>
                  <Txt variant="small" tone="body">
                    {r.firm.city} · {count(r.parties, "party", "parties")} ·{" "}
                    {count(r.vouchers, "entry", "entries")}
                  </Txt>
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                    <Badge
                      label={
                        r.firm.gstin ? `GSTIN ${r.firm.gstin}` : "No GSTIN"
                      }
                    />
                    <Badge
                      label={gstModeLabel(gstModeOf(r.firm))}
                      tone={
                        r.firm.gstRegistration === "regular"
                          ? "neutral"
                          : "warn"
                      }
                    />
                  </View>
                </View>
                {r.active ? (
                  <Icon name="check-circle" size={22} />
                ) : (
                  <Icon name="chevron-right" size={18} color={colors.body} />
                )}
              </Pressable>
            ))}
          </View>
        )}
      </QueryView>

      {adding ? (
        <AddFirm onCancel={() => setAdding(false)} />
      ) : (
        <Button
          label={firms.data?.length === 0 ? "Create firm" : "Add another firm"}
          icon="plus"
          onPress={() => setAdding(true)}
        />
      )}
    </Screen>
  );
}

function AddFirm({ onCancel }: { onCancel: () => void }) {
  const create = useCreateFirm();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("09");
  const [gst, setGst] = useState<GstSettingValue>({
    gstRegistration: "regular",
    gstin: "",
  });
  const [picking, setPicking] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const input = {
    name,
    city,
    stateCode,
    gstRegistration: gst.gstRegistration,
    compositionType: gst.compositionType,
    gstin: gst.gstRegistration === "unregistered" ? "" : gst.gstin,
  };
  const errors = checkNewFirm(input);
  const shown = showErrors ? errors : {};

  // GSTIN starts with the state code, so pick the state for the user
  const changeGstin = (value: string) => {
    const code = stateFromGstin(value);
    if (code) setStateCode(code);
  };

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    try {
      await create.mutateAsync(input);
      router.dismissTo("/");
    } catch (e) {
      showError("Couldn't add firm", e);
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Txt variant="heading">New firm</Txt>
      <TextField
        label="Firm name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Krishna Hardware"
        error={shown.name}
      />
      <TextField
        label="City"
        value={city}
        onChangeText={setCity}
        error={shown.city}
      />
      <View style={{ flexDirection: "row" }}>
        <SelectField
          label="State"
          value={`${stateName(stateCode)} (${stateCode})`}
          onPress={() => setPicking(true)}
        />
      </View>
      <GstSettingFields
        value={gst}
        onChange={setGst}
        onGstinChange={changeGstin}
        gstinError={shown.gstin}
      />
      <Txt variant="caption" tone="body">
        The new firm starts with empty books (cash account only). You can switch
        between firms any time from the firm name on Home.
      </Txt>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Cancel" onPress={onCancel} />
        <Button
          label="Create firm"
          variant="primary"
          loading={create.isPending}
          onPress={save}
          style={{ flex: 1 }}
        />
      </View>
      <PickerSheet
        visible={picking}
        title="State"
        searchPlaceholder="Search states"
        onClose={() => setPicking(false)}
        onSelect={(code) => {
          setStateCode(code);
          setPicking(false);
        }}
        options={STATES.map((s) => ({
          id: s.code,
          title: s.name,
          subtitle: s.code,
        }))}
      />
    </Card>
  );
}
