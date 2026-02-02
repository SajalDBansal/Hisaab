import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { View } from "react-native";
import { checkFirm, type FirmWithYear } from "@repo/core";
import {
  Button,
  Card,
  FooterBar,
  Notice,
  Header,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useFirm, useUpdateFirm } from "@/data/queries";
import {
  GstSettingFields,
  type GstSettingValue,
} from "@/forms/GstSettingFields";
import { space } from "@/theme";

/** Edit the firm details printed on invoices. */
export default function FirmProfileScreen() {
  const firm = useFirm();
  if (firm.data) return <Form firm={firm.data} />;
  return (
    <Screen header={<Header close title="Firm profile" />}>
      <QueryView query={firm}>{() => null}</QueryView>
    </Screen>
  );
}

function Form({ firm }: { firm: FirmWithYear }) {
  const update = useUpdateFirm();
  const [form, setForm] = useState({
    name: firm.name,
    address: firm.address ?? "",
    city: firm.city,
    phone: firm.phone ?? "",
    email: firm.email ?? "",
    gstin: firm.gstin,
    pan: firm.pan ?? "",
  });
  const [gst, setGst] = useState<GstSettingValue>({
    gstRegistration: firm.gstRegistration,
    compositionType: firm.compositionType,
    gstin: firm.gstin,
  });
  const gstChanged =
    gst.gstRegistration !== firm.gstRegistration ||
    (gst.compositionType ?? "") !== (firm.compositionType ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const set = (key: keyof typeof form) => (text: string) =>
    setForm({
      ...form,
      [key]:
        key === "gstin" || key === "pan" ? text.toUpperCase().trim() : text,
    });
  const gstOn = gst.gstRegistration !== "unregistered";
  const errors = checkFirm(
    { ...form, gstin: gstOn ? gst.gstin : "" },
    firm.stateCode,
  );
  if (gstOn && !gst.gstin)
    errors.gstin = "Enter the GSTIN, or untick GST registered.";
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined);

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length) return;
    try {
      await update.mutateAsync({
        ...form,
        phone: form.phone.replace(/\s/g, ""),
        gstin: gstOn ? gst.gstin : "",
        gstRegistration: gst.gstRegistration,
        compositionType: gst.compositionType,
      });
      backOrReplace(router, "/settings");
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title="Firm profile"
          subtitle="Printed on every invoice"
        />
      }
      footer={
        <FooterBar>
          <Txt variant="caption" tone="body" style={{ flex: 1 }}>
            State: {firm.state} ({firm.stateCode})
          </Txt>
          <Button
            label="Save"
            variant="primary"
            onPress={save}
            loading={update.isPending}
          />
        </FooterBar>
      }
    >
      <TextField
        label="Firm name"
        value={form.name}
        onChangeText={set("name")}
        error={err("name")}
      />
      <TextField
        label="Address"
        value={form.address}
        onChangeText={set("address")}
        multiline
      />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField label="City" value={form.city} onChangeText={set("city")} />
        <TextField label="State" value={firm.state} editable={false} />
      </View>
      <TextField
        label="Mobile"
        value={form.phone}
        onChangeText={set("phone")}
        keyboardType="phone-pad"
        error={err("phone")}
      />
      <TextField
        label="Email"
        value={form.email}
        onChangeText={set("email")}
        keyboardType="email-address"
        error={err("email")}
      />
      <Card style={{ gap: space.md }}>
        <Txt variant="heading">GST</Txt>
        <GstSettingFields
          value={gst}
          onChange={setGst}
          gstinError={err("gstin")}
        />
        {gstChanged ? (
          <Notice text="New bills follow this setting from now on. Bills already saved keep the GST treatment they were made with." />
        ) : null}
      </Card>
      <TextField
        label="PAN"
        value={form.pan}
        onChangeText={set("pan")}
        mono
        error={err("pan")}
      />
      <Txt variant="caption" tone="body">
        The state can't be changed here: it decides GST on every bill.
      </Txt>
    </Screen>
  );
}
