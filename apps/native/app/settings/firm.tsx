import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { View } from "react-native";
import {
  BUSINESS_TYPE_LABELS,
  BUSINESS_TYPES,
  checkFirm,
  checkFirmStatutory,
  MSME_LABELS,
  MSME_TYPES,
  OWNERSHIP_LABELS,
  OWNERSHIP_TYPES,
  type BusinessType,
  type FirmWithYear,
  type MsmeType,
  type OwnershipType,
} from "@repo/core";
import {
  Button,
  Card,
  Chip,
  PickerSheet,
  SelectField,
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
  // Business details (doc 37, T61); "" = not given.
  const [more, setMore] = useState({
    ownershipType: (firm.ownershipType ?? "") as OwnershipType | "",
    businessType: (firm.businessType ?? "") as BusinessType | "",
    industry: firm.industry ?? "",
    cin: firm.cin ?? "",
    tan: firm.tan ?? "",
    udyamNumber: firm.udyamNumber ?? "",
    msmeType: (firm.msmeType ?? "") as MsmeType | "",
    iec: firm.iec ?? "",
    fssai: firm.fssai ?? "",
    drugLicence: firm.drugLicence ?? "",
    website: firm.website ?? "",
  });
  const [picker, setPicker] = useState<"ownership" | "business" | null>(null);
  const setMoreText =
    (
      key:
        | "industry"
        | "cin"
        | "tan"
        | "udyamNumber"
        | "iec"
        | "fssai"
        | "drugLicence"
        | "website",
    ) =>
    (text: string) =>
      setMore({
        ...more,
        [key]: ["cin", "tan", "udyamNumber", "iec"].includes(key)
          ? text.toUpperCase().replace(/s/g, "")
          : key === "fssai"
            ? text.replace(/D/g, "").slice(0, 14)
            : text,
      });
  const moreErrors = checkFirmStatutory(more);
  const moreErr = (k: keyof typeof moreErrors) =>
    showErrors ? moreErrors[k] : undefined;
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
    if (Object.keys(errors).length || Object.keys(moreErrors).length) return;
    try {
      await update.mutateAsync({
        ...form,
        ...more,
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

      <Card style={{ gap: space.md }}>
        <View>
          <Txt variant="heading">Business details</Txt>
          <Txt variant="caption" tone="body">
            All optional. FSSAI and drug licence numbers print on every bill;
            CIN and Udyam on full-size bills.
          </Txt>
        </View>
        <SelectField
          label="Ownership"
          value={
            more.ownershipType
              ? OWNERSHIP_LABELS[more.ownershipType]
              : "Not set"
          }
          onPress={() => setPicker("ownership")}
          error={moreErr("ownershipType")}
        />
        <SelectField
          label="Type of business"
          value={
            more.businessType
              ? BUSINESS_TYPE_LABELS[more.businessType]
              : "Not set"
          }
          onPress={() => setPicker("business")}
          error={moreErr("businessType")}
        />
        <TextField
          label="Industry"
          value={more.industry}
          onChangeText={setMoreText("industry")}
          placeholder="e.g. Pharmacy, Building material"
          error={moreErr("industry")}
        />
        <TextField
          label="CIN or LLPIN"
          value={more.cin}
          onChangeText={setMoreText("cin")}
          placeholder="Companies and LLPs"
          mono
          error={moreErr("cin")}
        />
        <TextField
          label="TAN"
          value={more.tan}
          onChangeText={setMoreText("tan")}
          placeholder="For TDS / TCS"
          mono
          error={moreErr("tan")}
        />
        <View style={{ gap: space.sm }}>
          <Txt variant="label" tone="charcoal">
            MSME (Udyam)
          </Txt>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Chip
              label="Not MSME"
              selected={!more.msmeType}
              onPress={() =>
                setMore({ ...more, msmeType: "", udyamNumber: "" })
              }
            />
            {MSME_TYPES.map((t) => (
              <Chip
                key={t}
                label={MSME_LABELS[t]}
                selected={more.msmeType === t}
                onPress={() => setMore({ ...more, msmeType: t })}
              />
            ))}
          </View>
          {moreErr("msmeType") ? (
            <Txt variant="caption" tone="give">
              {moreErr("msmeType")}
            </Txt>
          ) : null}
        </View>
        {more.msmeType ? (
          <TextField
            label="Udyam registration number"
            value={more.udyamNumber}
            onChangeText={setMoreText("udyamNumber")}
            placeholder="UDYAM-UP-09-0012345"
            mono
            error={moreErr("udyamNumber")}
          />
        ) : null}
        <TextField
          label="FSSAI licence number"
          value={more.fssai}
          onChangeText={setMoreText("fssai")}
          placeholder="14 digits, for food businesses"
          keyboardType="number-pad"
          mono
          error={moreErr("fssai")}
        />
        <TextField
          label="Drug licence number"
          value={more.drugLicence}
          onChangeText={setMoreText("drugLicence")}
          placeholder="e.g. 20B/UP/123, 21B/UP/124"
          error={moreErr("drugLicence")}
        />
        <TextField
          label="IEC (import-export code)"
          value={more.iec}
          onChangeText={setMoreText("iec")}
          mono
          error={moreErr("iec")}
        />
        <TextField
          label="Website"
          value={more.website}
          onChangeText={setMoreText("website")}
          placeholder="www.example.com"
          keyboardType="url"
          autoCapitalize="none"
          error={moreErr("website")}
        />
      </Card>

      <PickerSheet
        visible={picker !== null}
        title={picker === "ownership" ? "Ownership" : "Type of business"}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "ownership")
            setMore({ ...more, ownershipType: id as OwnershipType | "" });
          else setMore({ ...more, businessType: id as BusinessType | "" });
          setPicker(null);
        }}
        options={[
          { id: "", title: "Not set" },
          ...(picker === "ownership"
            ? OWNERSHIP_TYPES.map((t) => ({
                id: t,
                title: OWNERSHIP_LABELS[t],
              }))
            : BUSINESS_TYPES.map((t) => ({
                id: t,
                title: BUSINESS_TYPE_LABELS[t],
              }))),
        ]}
      />
    </Screen>
  );
}
