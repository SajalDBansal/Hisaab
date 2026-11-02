/**
 * Add or edit a customer / supplier.
 * GSTIN fills the state; the state decides CGST + SGST or IGST on bills.
 */
import { router } from "expo-router";
import { backOrReplace } from "@/navigation";
import { useState } from "react";
import { View } from "react-native";
import {
  checkParty,
  gstinProblem,
  parseRupees,
  stateFromGstin,
  stateName,
  STATES,
  type Party,
  type PartyInput,
  type PartyType,
} from "@repo/core";
import {
  AmountField,
  Button,
  Card,
  Chip,
  FooterBar,
  Header,
  PickerSheet,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { toRupeeText } from "@/data/labels";
import { setPicked } from "@/data/picked";
import { useFirm, useParties, useSaveParty } from "@/data/queries";
import { space } from "@/theme";
import { useGstMode } from "@/data/gstMode";

const CREDIT_DAYS = [0, 7, 15, 30, 45, 60];

export function PartyForm({
  party,
  type: initialType = "customer",
  typeLocked,
  pick,
}: {
  /** Editing this party; leave out to add a new one. */
  party?: Party;
  type?: PartyType;
  /** The party already has entries, so customer/supplier can't change. */
  typeLocked?: boolean;
  /** Opened from a sale/purchase picker: hand the new party back to it. */
  pick?: boolean;
}) {
  const firm = useFirm();
  const all = useParties();
  const [version] = useState(party?.version);
  const save = useSaveParty(party?.id, version);
  const firmState = firm.data?.stateCode ?? "09";
  const gst = useGstMode();

  const [type, setType] = useState<PartyType>(party?.type ?? initialType);
  const [name, setName] = useState(party?.name ?? "");
  const [phone, setPhone] = useState(party?.phone ?? "");
  const [gstin, setGstin] = useState(party?.gstin ?? "");
  const [stateCode, setStateCode] = useState(party?.stateCode ?? "");
  const [city, setCity] = useState(party?.city ?? "");
  const [creditDays, setCreditDays] = useState(String(party?.creditDays ?? 15));
  const [limitText, setLimitText] = useState(
    toRupeeText(party?.creditLimit ?? 0),
  );
  const [openingText, setOpeningText] = useState(
    toRupeeText(Math.abs(party?.openingBalance ?? 0)),
  );
  // Opening balance direction: "get" = they owe you, "give" = you owe them
  const [openingSide, setOpeningSide] = useState<"get" | "give">(
    party
      ? party.openingBalance < 0
        ? "give"
        : "get"
      : initialType === "supplier"
        ? "give"
        : "get",
  );
  const [pickState, setPickState] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const gstinValid = !gstinProblem(gstin) && !!stateFromGstin(gstin);
  // A valid GSTIN decides the state; otherwise the user picks it (default: firm's state)
  const effectiveState = gstinValid
    ? gstin.slice(0, 2)
    : stateCode || firmState;
  const opening = parseRupees(openingText) ?? 0;

  const input: PartyInput = {
    type,
    name,
    phone,
    gstin: gstin || undefined,
    stateCode: effectiveState,
    city,
    creditDays: Number(creditDays || "0"),
    creditLimit: parseRupees(limitText) ?? 0,
    openingBalance: openingSide === "get" ? opening : -opening,
  };
  const errors = checkParty(
    input,
    (all.data ?? []).map((r) => r.party),
    party?.id,
  );
  const err = (k: keyof typeof errors) => (showErrors ? errors[k] : undefined);
  const firstError = Object.values(errors)[0];
  const word = type === "customer" ? "customer" : "supplier";

  const submit = async () => {
    setShowErrors(true);
    if (firstError) return;
    try {
      const saved = await save.mutateAsync(input);
      if (pick) setPicked("party", saved.id);
      if (party || pick) backOrReplace(router, `/party/${saved.id}`);
      else router.replace(`/party/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  return (
    <Screen
      header={
        <Header
          close
          title={party ? `Edit ${word}` : `New ${word}`}
          subtitle={
            party ? party.name : "Name is enough to start; add the rest later"
          }
        />
      }
      footer={
        <FooterBar>
          <Txt
            variant="caption"
            tone={showErrors && firstError ? "give" : "body"}
            style={{ flex: 1 }}
            numberOfLines={2}
          >
            {showErrors && firstError
              ? firstError
              : !gst.regular
                ? gst.composition && effectiveState !== firmState
                  ? "Other state · a composition firm can't sell to them"
                  : ""
                : effectiveState === firmState
                  ? "Same state · CGST + SGST on bills"
                  : "Other state · IGST on bills"}
          </Txt>
          <Button
            label={party ? "Save changes" : `Save ${word}`}
            variant="primary"
            onPress={submit}
            loading={save.isPending}
          />
        </FooterBar>
      }
    >
      {typeLocked || pick ? null : (
        <Segmented
          value={type}
          onChange={(t) => {
            setType(t);
            if (!party) setOpeningSide(t === "supplier" ? "give" : "get");
          }}
          options={[
            { value: "customer", label: "Customer" },
            { value: "supplier", label: "Supplier" },
          ]}
        />
      )}

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Shop or person's name"
        error={err("name")}
      />
      <TextField
        label="Mobile"
        value={phone}
        onChangeText={(t) => setPhone(t.replace(/[^\d ]/g, ""))}
        keyboardType="phone-pad"
        placeholder="For WhatsApp reminders"
        error={err("phone")}
      />

      <View style={{ gap: space.sm }}>
        {gst.on ? (
          <TextField
            label="GSTIN (leave empty if unregistered)"
            value={gstin}
            onChangeText={(t) =>
              setGstin(
                t
                  .toUpperCase()
                  .replace(/[^0-9A-Z]/g, "")
                  .slice(0, 15),
              )
            }
            placeholder="15 characters"
            mono
            error={err("gstin")}
          />
        ) : null}
        {gstinValid ? (
          <Txt variant="caption" tone="get">
            State from GSTIN: {stateName(effectiveState)}
          </Txt>
        ) : null}
        <View style={{ flexDirection: "row", gap: space.md }}>
          {gstinValid ? (
            <TextField
              label="State"
              value={stateName(effectiveState)}
              editable={false}
            />
          ) : (
            <SelectField
              label="State"
              value={stateName(effectiveState)}
              onPress={() => setPickState(true)}
              error={err("stateCode")}
            />
          )}
        </View>
        <TextField
          label="City"
          value={city}
          onChangeText={setCity}
          placeholder="e.g. Mathura"
        />
      </View>

      <Card style={{ gap: space.md }}>
        <Txt variant="bodyStrong">Credit</Txt>
        <View style={{ gap: space.sm }}>
          <Txt variant="label" tone="charcoal">
            Days to pay
          </Txt>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            {CREDIT_DAYS.map((d) => (
              <Chip
                key={d}
                label={d === 0 ? "Cash" : `${d} days`}
                selected={Number(creditDays) === d}
                onPress={() => setCreditDays(String(d))}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row" }}>
            <TextField
              label="Or type days"
              value={creditDays}
              onChangeText={(t) =>
                setCreditDays(t.replace(/\D/g, "").slice(0, 3))
              }
              keyboardType="number-pad"
              error={err("creditDays")}
            />
          </View>
        </View>
        <AmountField
          label="Credit limit ₹ (empty = no limit)"
          value={limitText}
          onChangeText={setLimitText}
          error={err("creditLimit")}
        />
      </Card>

      <Card style={{ gap: space.md }}>
        <View>
          <Txt variant="bodyStrong">Opening balance</Txt>
          <Txt variant="caption" tone="body">
            What was pending before you started using the app
          </Txt>
        </View>
        <Segmented
          value={openingSide}
          onChange={setOpeningSide}
          options={[
            { value: "get", label: "They owe you" },
            { value: "give", label: "You owe them" },
          ]}
        />
        <AmountField
          label="Amount ₹"
          value={openingText}
          onChangeText={setOpeningText}
        />
      </Card>

      <PickerSheet
        visible={pickState}
        title="State"
        searchPlaceholder="Search state"
        onClose={() => setPickState(false)}
        onSelect={(code) => {
          setStateCode(code);
          setPickState(false);
        }}
        options={STATES.map((s) => ({
          id: s.code,
          title: s.name,
          subtitle: `Code ${s.code}`,
        }))}
      />
    </Screen>
  );
}
