import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, parseRupees, today } from "@repo/core";
import { InventoryAdjustmentInput } from "@repo/contracts/src/inventory";
import {
  AmountField,
  Button,
  DateField,
  EmptyState,
  Header,
  PickerSheet,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useItems, useLedgers, useStockLots } from "@/data/queries";
import { useInventoryAccess, useInventoryWrite } from "@/data/inventoryHooks";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";
import { space } from "@/theme";

export default function InventoryAdjustmentScreen() {
  const access = useInventoryAccess();
  return (
    <Screen header={<Header close title="Stock adjustment" />}>
      {!access.write || !access.connected ? (
        <EmptyState title="Sign in as an owner or accountant" />
      ) : (
        <AdjustmentForm />
      )}
    </Screen>
  );
}

function AdjustmentForm() {
  const [date, setDate] = useState(today());
  const lots = useStockLots(date);
  const items = useItems();
  const ledgers = useLedgers();
  const write = useInventoryWrite();
  const attachments = useFinancialAttachments();
  const [kind, setKind] = useState<InventoryAdjustmentInput["kind"]>("count");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");
  const [offsetAccount, setOffset] = useState("expense:Freight Inward");
  const [reason, setReason] = useState("");
  const [picker, setPicker] = useState<"lot" | "account" | null>(null);
  const lot = lots.data?.find((row) => row.id === lotId);
  const name = (itemId: string) =>
    items.data?.find((row) => row.item.id === itemId)?.item.name ?? "Item";
  const accounts = [
    { id: "expense:Freight Inward", title: "Freight Inward" },
    { id: "expense:Loading & Unloading", title: "Loading & Unloading" },
    ...(ledgers.data ?? []).map(({ ledger }) => ({
      id: `ledger:${ledger.id}`,
      title: ledger.name,
    })),
  ];
  const parsed = InventoryAdjustmentInput.safeParse({
    kind,
    date,
    itemId: lot?.itemId,
    lotId,
    expectedQty: lot?.qty,
    expectedValue: lot?.value,
    quantity: quantity.trim() ? Number(quantity) : undefined,
    amount: parseRupees(amount) ?? undefined,
    offsetAccount,
    reason,
  });
  async function save() {
    if (!parsed.success || write.isPending || attachments.busy) return;
    try {
      const saved = await attachments.save(
        "/inventory/adjustments",
        parsed.data,
        write.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (error) {
      showError("Could not save stock adjustment", error);
    }
  }
  return (
    <View style={{ gap: space.md }}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "count", label: "Count" },
          { value: "damage", label: "Loss" },
          { value: "landed-cost", label: "Landed cost" },
        ]}
      />
      <DateField
        value={date}
        onChange={(value) => {
          setDate(value);
          setLotId("");
        }}
      />
      <SelectField
        label="Stock lot"
        value={lot ? `${name(lot.itemId)} - ${lot.number}` : undefined}
        onPress={() => setPicker("lot")}
      />
      {lots.error ? <Txt tone="give">{lots.error.message}</Txt> : null}
      {lot ? (
        <Txt>
          {lot.qty} on hand | {lot.bookScope === "gst" ? "GST" : "Non-GST"} |
          Cost {formatINR(lot.value)}
        </Txt>
      ) : null}
      {kind === "landed-cost" ? (
        <>
          <AmountField
            label="Cost allocated to stock on hand"
            value={amount}
            onChangeText={setAmount}
          />
          <SelectField
            label="Cost source"
            value={accounts.find((row) => row.id === offsetAccount)?.title}
            onPress={() => setPicker("account")}
          />
        </>
      ) : (
        <TextField
          label={
            kind === "count" ? "Counted quantity" : "Lost / damaged quantity"
          }
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
        />
      )}
      <View>
        <TextField
          label="Reason / cost reference"
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={300}
        />
      </View>
      <AttachmentPicker {...attachments} />
      <Button
        label="Post adjustment"
        icon="check"
        variant="primary"
        onPress={save}
        loading={write.isPending || attachments.busy}
        disabled={!parsed.success}
      />
      <PickerSheet
        visible={picker === "lot"}
        title="Stock lot"
        options={(lots.data ?? [])
          .filter((row) => row.qty >= 0)
          .map((row) => ({
            id: row.id,
            title: name(row.itemId),
            subtitle: `${row.number} | ${row.bookScope} | ${row.qty} | ${formatINR(row.value)}`,
          }))}
        onSelect={(id) => {
          setLotId(id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === "account"}
        title="Cost source"
        options={accounts}
        onSelect={(id) => {
          setOffset(id);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}
