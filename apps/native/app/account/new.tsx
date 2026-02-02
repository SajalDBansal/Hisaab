import { router } from "expo-router";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";
import { useState } from "react";
import { View } from "react-native";
import {
  CUSTOM_ACCOUNT_GROUPS,
  groupInfo,
  type AccountInput,
  type GroupName,
} from "@repo/core";
import { AccountInput as AccountSchema, LedgerInput } from "@repo/contracts";
import { parseRupees } from "@repo/core";
import {
  AmountField,
  Button,
  FooterBar,
  Header,
  PickerSheet,
  Screen,
  Segmented,
  SelectField,
  TextField,
  showError,
} from "@/components";
import { useCreateAccount, useCreateLedger } from "@/data/queries";
import { space } from "@/theme";

const GROUPS = [
  ...CUSTOM_ACCOUNT_GROUPS,
  "Cash-in-hand",
  "Bank Accounts",
] as const;

export default function NewAccountScreen() {
  const attachments = useFinancialAttachments(undefined, "account");
  const create = useCreateAccount();
  const createLedger = useCreateLedger();
  const [name, setName] = useState("");
  const [group, setGroup] = useState<GroupName>("Unsecured Loans");
  const [opening, setOpening] = useState("0");
  const [side, setSide] = useState<"dr" | "cr">("cr");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const cashBank = group === "Cash-in-hand" || group === "Bank Accounts";

  const save = async () => {
    try {
      const amount = parseRupees(opening || "0");
      if (amount === null || amount < 0)
        throw new Error("Enter a valid opening balance.");
      const openingBalance = amount * (side === "dr" ? 1 : -1);
      if (cashBank) {
        const saved = await attachments.save(
          "/ledgers",
          LedgerInput.parse({
            name,
            openingBalance,
            kind: group === "Cash-in-hand" ? "cash" : "bank",
            shortName: name.trim().slice(0, 20),
          }),
          createLedger.mutateAsync,
        );
        router.replace(`/ledger/${saved.id}`);
      } else {
        const input: AccountInput = AccountSchema.parse({
          name,
          group,
          openingBalance,
          contactName,
          phone,
          note,
        });
        const saved = await attachments.save(
          "/accounts/masters",
          input,
          create.mutateAsync,
        );
        router.replace(`/account/${encodeURIComponent(`account:${saved.id}`)}`);
      }
    } catch (e) {
      showError("Couldn't create ledger", e);
    }
  };

  return (
    <Screen
      header={<Header close title="New ledger" />}
      footer={
        <FooterBar>
          <Button
            label="Create ledger"
            icon="check"
            variant="primary"
            block
            onPress={save}
            loading={
              create.isPending || createLedger.isPending || attachments.busy
            }
          />
        </FooterBar>
      }
    >
      <TextField
        label="Ledger name"
        value={name}
        onChangeText={setName}
        maxLength={150}
      />
      <SelectField
        label="Account group"
        value={group}
        onPress={() => setPicking(true)}
      />
      <View style={{ gap: space.sm }}>
        <AmountField
          label="Opening balance (Rs)"
          value={opening}
          onChangeText={setOpening}
        />
        <Segmented
          value={side}
          onChange={setSide}
          options={[
            { value: "dr", label: "Debit (Dr)" },
            { value: "cr", label: "Credit (Cr)" },
          ]}
        />
      </View>
      {!cashBank ? (
        <>
          <TextField
            label="Contact name"
            value={contactName}
            onChangeText={setContactName}
            maxLength={150}
          />
          <TextField
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={30}
          />
          <View style={{ flexDirection: "row" }}>
            <TextField
              label="Notes / agreed terms"
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
            />
          </View>
        </>
      ) : null}
      <PickerSheet
        visible={picking}
        title="Account group"
        onClose={() => setPicking(false)}
        options={GROUPS.map((g) => ({ id: g, title: g }))}
        onSelect={(id) => {
          const selected = id as GroupName;
          setGroup(selected);
          setSide(
            ["liability", "income"].includes(groupInfo(selected).nature)
              ? "cr"
              : "dr",
          );
          setPicking(false);
        }}
      />
      <AttachmentPicker {...attachments} />
    </Screen>
  );
}
