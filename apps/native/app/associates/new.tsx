import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { today } from "@repo/core";
import {
  AssociateInput,
  type AssociateRecord,
  type AssociateField,
} from "@repo/contracts/src/associates";
import {
  Button,
  Checkbox,
  DateField,
  Header,
  PickerSheet,
  QueryView,
  Screen,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { AssociateFields } from "@/components/associates/AssociateFields";
import { AssociateGate } from "@/components/associates/AssociateGate";
import {
  useAssociate,
  useAssociateFields,
  useSaveAssociate,
} from "@/data/associateHooks";
import { useAccountMasters, useItems, useParties } from "@/data/queries";
import { space } from "@/theme";

export default function AssociateEditor() {
  const { id = "" } = useLocalSearchParams<{ id?: string }>();
  const query = useAssociate(id);
  const definitions = useAssociateFields();
  return (
    <Screen
      header={<Header close title={id ? "Edit associate" : "New associate"} />}
    >
      <AssociateGate>
        <QueryView query={definitions}>
          {(fields) =>
            id ? (
              <QueryView query={query}>
                {(detail) => (
                  <ProfileForm
                    key={id}
                    original={detail.associate}
                    definitions={fields}
                  />
                )}
              </QueryView>
            ) : (
              <ProfileForm definitions={fields} />
            )
          }
        </QueryView>
      </AssociateGate>
    </Screen>
  );
}

function ProfileForm({
  original,
  definitions,
}: {
  original?: AssociateRecord;
  definitions: AssociateField[];
}) {
  const [initial] = useState(original);
  const [form, setForm] = useState<AssociateInput>(() =>
    initial
      ? {
          name: initial.name,
          phone: initial.phone,
          email: initial.email,
          address: initial.address,
          notes: initial.notes,
          active: initial.active,
          roles: [...initial.roles],
          partyIds: [...initial.partyIds],
          delivery: initial.delivery,
          commission: initial.commission,
          fields: { ...initial.fields },
        }
      : {
          name: "",
          phone: "",
          email: "",
          address: "",
          notes: "",
          active: true,
          roles: ["delivery"],
          partyIds: [],
          delivery: {
            vehicle: "",
            area: "",
            contactPreference: "phone",
            printPhone: false,
          },
          commission: null,
          fields: {},
        },
  );
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState(String(initial?.commission?.rate ?? 0));
  const [groupText, setGroupText] = useState(
    initial?.commission?.groups.join(", ") ?? "",
  );
  const [picker, setPicker] = useState<
    "account" | "item" | "party" | "contact" | null
  >(null);
  const accounts = useAccountMasters();
  const items = useItems();
  const parties = useParties();
  const save = useSaveAssociate(initial?.id);
  const parsed = AssociateInput.safeParse({
    ...form,
    commission: form.commission
      ? {
          ...form.commission,
          rate: rate.trim() ? Number(rate) : -1,
          groups: groupText
            .split(",")
            .map((g) => g.trim())
            .filter(Boolean),
        }
      : null,
  });
  const change = <K extends keyof AssociateInput>(
    key: K,
    value: AssociateInput[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const role = (name: AssociateInput["roles"][number], enabled: boolean) =>
    setForm((current) => ({
      ...current,
      roles: enabled
        ? [...current.roles, name]
        : current.roles.filter((r) => r !== name),
      delivery:
        name === "delivery"
          ? enabled
            ? {
                vehicle: "",
                area: "",
                printPhone: false,
                contactPreference: "phone",
              }
            : null
          : current.delivery,
      commission:
        name === "commission-partner"
          ? enabled
            ? {
                payableAccountId: "",
                rate: 0,
                effectiveFrom: today(),
                itemIds: [],
                groups: [],
                allowOverride: false,
              }
            : null
          : current.commission,
    }));
  const submit = async () => {
    if (!parsed.success || save.isPending) return;
    try {
      const result = await save.mutateAsync({
        data: parsed.data,
        version: initial?.version,
        reason,
      });
      router.replace(`/associates/${result.id}`);
    } catch (error) {
      showError("Couldn't save associate", error);
    }
  };
  const pickerOptions =
    picker === "account"
      ? (accounts.data ?? [])
          .filter(
            (a) =>
              ["Other Current Liabilities", "Provisions"].includes(a.group) &&
              a.openingBalance === 0,
          )
          .map((a) => ({ id: a.id, title: a.name, subtitle: a.group }))
      : picker === "item"
        ? (items.data ?? []).map(({ item: i }) => ({
            id: i.id,
            title: i.name,
            subtitle: i.group,
          }))
        : picker === "party"
          ? (parties.data ?? []).map(({ party: p }) => ({
              id: p.id,
              title: p.name,
              subtitle: p.type,
            }))
          : ["phone", "message", "none"].map((id) => ({ id, title: id }));
  return (
    <View style={{ gap: space.lg }}>
      <TextField
        label="Name"
        value={form.name}
        onChangeText={(v) => change("name", v)}
        maxLength={150}
      />
      <TextField
        label="Phone"
        value={form.phone}
        onChangeText={(v) => change("phone", v)}
        keyboardType="phone-pad"
        maxLength={40}
      />
      <TextField
        label="Email"
        value={form.email}
        onChangeText={(v) => change("email", v)}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextField
        label="Address"
        value={form.address}
        onChangeText={(v) => change("address", v)}
        multiline
        maxLength={500}
      />
      <Txt variant="bodyStrong">Roles</Txt>
      <Checkbox
        label="Delivery"
        checked={form.roles.includes("delivery")}
        onChange={(v) => role("delivery", v)}
      />
      <Checkbox
        label="Referral"
        checked={form.roles.includes("referral")}
        onChange={(v) => role("referral", v)}
      />
      <Checkbox
        label="Commission partner"
        checked={form.roles.includes("commission-partner")}
        onChange={(v) => role("commission-partner", v)}
      />
      {form.delivery ? (
        <>
          <TextField
            label="Vehicle / registration"
            value={form.delivery.vehicle}
            onChangeText={(vehicle) =>
              change("delivery", { ...form.delivery!, vehicle })
            }
            maxLength={100}
          />
          <TextField
            label="Delivery area"
            value={form.delivery.area}
            onChangeText={(area) =>
              change("delivery", { ...form.delivery!, area })
            }
            maxLength={200}
          />
          <SelectField
            label="Contact preference"
            value={form.delivery.contactPreference}
            onPress={() => setPicker("contact")}
          />
          <Checkbox
            label="Print phone on customer documents"
            checked={form.delivery.printPhone}
            onChange={(printPhone) =>
              change("delivery", { ...form.delivery!, printPhone })
            }
          />
        </>
      ) : null}
      {form.commission ? (
        <>
          <SelectField
            label="Commission payable account"
            value={
              accounts.data?.find(
                (a) => a.id === form.commission?.payableAccountId,
              )?.name
            }
            onPress={() => setPicker("account")}
          />
          <Button
            label="New payable account"
            icon="plus"
            onPress={() => router.push("/account/new")}
          />
          <TextField
            label="Commission (%)"
            value={rate}
            onChangeText={setRate}
            keyboardType="decimal-pad"
          />
          <DateField
            label="Effective from"
            value={form.commission.effectiveFrom}
            onChange={(effectiveFrom) =>
              change("commission", { ...form.commission!, effectiveFrom })
            }
          />
          <Checkbox
            label="Allow accountant rate overrides"
            checked={form.commission.allowOverride}
            onChange={(allowOverride) =>
              change("commission", { ...form.commission!, allowOverride })
            }
          />
          <TextField
            label="Eligible item groups (comma separated)"
            value={groupText}
            onChangeText={setGroupText}
          />
          {form.commission.itemIds.map((id) => (
            <Checkbox
              key={id}
              label={items.data?.find((i) => i.item.id === id)?.item.name ?? id}
              checked
              onChange={() =>
                change("commission", {
                  ...form.commission!,
                  itemIds: form.commission!.itemIds.filter((i) => i !== id),
                })
              }
            />
          ))}
          <Button
            label="Add eligible item"
            icon="plus"
            onPress={() => setPicker("item")}
          />
        </>
      ) : null}
      {form.partyIds.map((id) => (
        <Checkbox
          key={id}
          label={parties.data?.find((p) => p.party.id === id)?.party.name ?? id}
          checked
          onChange={() =>
            change(
              "partyIds",
              form.partyIds.filter((p) => p !== id),
            )
          }
        />
      ))}
      <Button
        label="Link trading account"
        icon="link"
        onPress={() => setPicker("party")}
      />
      <AssociateFields
        definitions={definitions}
        values={form.fields}
        onChange={(values) => change("fields", values)}
      />
      <TextField
        label="Notes"
        value={form.notes}
        onChangeText={(v) => change("notes", v)}
        multiline
        maxLength={1000}
      />
      <Checkbox
        label="Active"
        checked={form.active}
        onChange={(v) => change("active", v)}
      />
      {initial ? (
        <TextField
          label="Reason for change"
          value={reason}
          onChangeText={setReason}
          maxLength={500}
        />
      ) : null}
      {!parsed.success ? (
        <Txt variant="caption" tone="give">
          {parsed.error.issues[0]?.message}
        </Txt>
      ) : null}
      <Button
        label="Save associate"
        icon="check"
        variant="primary"
        loading={save.isPending}
        disabled={!parsed.success || (!!initial && !reason.trim())}
        onPress={submit}
      />
      <PickerSheet
        visible={!!picker}
        title={
          picker === "account"
            ? "Payable account"
            : picker === "item"
              ? "Eligible item"
              : picker === "party"
                ? "Trading account"
                : "Contact preference"
        }
        options={pickerOptions}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "account")
            change("commission", { ...form.commission!, payableAccountId: id });
          if (picker === "item")
            change("commission", {
              ...form.commission!,
              itemIds: [...new Set([...form.commission!.itemIds, id])],
            });
          if (picker === "party")
            change("partyIds", [...new Set([...form.partyIds, id])]);
          if (picker === "contact")
            change("delivery", {
              ...form.delivery!,
              contactPreference: id as "phone" | "message" | "none",
            });
          setPicker(null);
        }}
      />
    </View>
  );
}
