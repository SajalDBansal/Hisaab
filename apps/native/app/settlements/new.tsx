import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, parseRupees, today } from "@repo/core";
import {
  SettlementInput,
  type SettlementContext,
} from "@repo/contracts/src/settlements";
import {
  AmountField,
  Button,
  Checkbox,
  DateField,
  EmptyState,
  Header,
  PickerSheet,
  QueryView,
  Screen,
  Segmented,
  SelectField,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useLedgers, useParties } from "@/data/queries";
import {
  useCreateSettlement,
  useSettlementAccess,
  useSettlementContext,
} from "@/data/settlementHooks";
import { space } from "@/theme";

const kinds = [
  { id: "advance-receipt", title: "Customer advance" },
  { id: "advance-payment", title: "Supplier advance" },
  { id: "customer-refund", title: "Refund to customer" },
  { id: "supplier-refund", title: "Refund from supplier" },
  { id: "receivable-writeoff", title: "Write off receivable" },
  { id: "payable-writeoff", title: "Write back payable" },
  { id: "allocation-correction", title: "Correct bill allocation" },
] as const;
type Kind = SettlementInput["kind"];

export default function NewSettlement() {
  const access = useSettlementAccess();
  const [kind, setKind] = useState<Kind>("advance-receipt"),
    [partyId, setParty] = useState("");
  const [bookScope, setScope] = useState<"gst" | "nongst">("nongst"),
    [date, setDate] = useState(today());
  const [picker, setPicker] = useState<"kind" | "party" | null>(null);
  const parties = useParties();
  const context = useSettlementContext({ partyId, date, bookScope });
  const want = [
    "advance-receipt",
    "customer-refund",
    "receivable-writeoff",
  ].includes(kind)
    ? "customer"
    : "supplier";
  const partyRows = (parties.data ?? [])
    .map((row) => row.party)
    .filter((p) => kind === "allocation-correction" || p.type === want);
  const options = kinds.filter(
    (k) => access.owner || !k.id.endsWith("writeoff"),
  );
  return (
    <Screen header={<Header close title="New settlement" />}>
      {!access.write || !access.connected ? (
        <EmptyState title="Connected owner or accountant required" />
      ) : (
        <View style={{ gap: space.lg }}>
          <SelectField
            label="Operation"
            value={kinds.find((k) => k.id === kind)?.title}
            onPress={() => setPicker("kind")}
          />
          <QueryView query={parties}>
            {() => (
              <SelectField
                label="Party"
                value={partyRows.find((p) => p.id === partyId)?.name}
                onPress={() => setPicker("party")}
              />
            )}
          </QueryView>
          <Segmented
            value={bookScope}
            onChange={setScope}
            options={[
              { value: "gst", label: "GST" },
              { value: "nongst", label: "Non-GST" },
            ]}
          />
          <DateField value={date} onChange={setDate} max={today()} />
          {partyId ? (
            <QueryView query={context}>
              {(review) => (
                <SettlementForm
                  key={`${kind}:${partyId}:${date}:${bookScope}`}
                  review={review}
                  kind={kind}
                  date={date}
                  bookScope={bookScope}
                />
              )}
            </QueryView>
          ) : null}
          <PickerSheet
            visible={picker !== null}
            title={picker === "kind" ? "Settlement operation" : "Party"}
            options={
              picker === "kind"
                ? [...options]
                : partyRows.map((p) => ({ id: p.id, title: p.name }))
            }
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              if (picker === "kind") {
                const selected = kinds.find((k) => k.id === id);
                if (selected) setKind(selected.id);
                setParty("");
              } else setParty(id);
              setPicker(null);
            }}
          />
        </View>
      )}
    </Screen>
  );
}

function SettlementForm({
  review,
  kind,
  date,
  bookScope,
}: {
  review: SettlementContext;
  kind: Kind;
  date: string;
  bookScope: "gst" | "nongst";
}) {
  const [original] = useState(review);
  const [amount, setAmount] = useState(""),
    [ledgerId, setLedger] = useState(""),
    [sourceId, setSource] = useState("");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<"ledger" | "source" | null>(null);
  const ledgers = useLedgers(),
    save = useCreateSettlement();
  const allocated =
    kind.endsWith("writeoff") || kind === "allocation-correction";
  const source = original.sources.find((s) => s.id === sourceId);
  const allocations = Object.entries(amounts)
    .filter(([, text]) => text.trim() !== "" && parseRupees(text) !== 0)
    .map(([voucherId, text]) => ({ voucherId, amount: parseRupees(text) }));
  const parsed = SettlementInput.safeParse({
    kind,
    partyId: original.partyId,
    partyVersion: original.partyVersion,
    date,
    bookScope,
    reason,
    ...(allocated
      ? { allocations }
      : { amount: parseRupees(amount), ledgerId }),
    ...(kind === "allocation-correction"
      ? {
          sourceVoucherId: source?.id,
          sourceVersion: source?.version,
          revision: source?.revision,
        }
      : {}),
  });
  const submit = async () => {
    if (!parsed.success || !confirmed || save.isPending) return;
    try {
      const entry = await save.mutateAsync(parsed.data);
      router.replace(`/settlements/${entry.id}`);
    } catch (error) {
      showError("Couldn't post settlement", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt>
        Party balance {formatINR(Math.abs(original.balance))}{" "}
        {original.balance < 0 ? "Cr" : "Dr"}
      </Txt>
      {kind === "allocation-correction" ? (
        <SelectField
          label="Original receipt/payment"
          value={source?.number}
          onPress={() => setPicker("source")}
        />
      ) : null}
      {source ? (
        <Txt>
          Source amount {formatINR(source.amount)} | Allocated{" "}
          {formatINR(allocations.reduce((sum, a) => sum + (a.amount ?? 0), 0))}
        </Txt>
      ) : null}
      {allocated ? (
        original.bills
          .filter(
            (bill) =>
              bill.pending > 0 ||
              source?.allocations.some((a) => a.voucherId === bill.id),
          )
          .map((bill) => (
            <AmountField
              key={bill.id}
              label={`${bill.number} | Pending ${formatINR(bill.pending)}`}
              value={amounts[bill.id] ?? ""}
              onChangeText={(text) => {
                setAmounts((old) => ({ ...old, [bill.id]: text }));
                setConfirmed(false);
              }}
            />
          ))
      ) : (
        <>
          <AmountField
            label="Amount"
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setConfirmed(false);
            }}
          />
          <QueryView query={ledgers}>
            {(rows) => (
              <SelectField
                label="Cash / bank"
                value={rows.find((l) => l.ledger.id === ledgerId)?.ledger.name}
                onPress={() => setPicker("ledger")}
              />
            )}
          </QueryView>
        </>
      )}
      <TextField
        label="Reason / supporting reference"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        multiline
      />
      <Checkbox
        label="I approve these accounts, amounts and bill allocations"
        checked={confirmed}
        onChange={setConfirmed}
      />
      <Button
        label="Post settlement"
        icon="check"
        variant="primary"
        loading={save.isPending}
        disabled={!parsed.success || !confirmed}
        onPress={submit}
      />
      <PickerSheet
        visible={picker !== null}
        title={picker === "source" ? "Original entry" : "Cash / bank"}
        options={
          picker === "source"
            ? original.sources.map((s) => ({
                id: s.id,
                title: s.number,
                subtitle: formatINR(s.amount),
              }))
            : (ledgers.data ?? []).map((l) => ({
                id: l.ledger.id,
                title: l.ledger.name,
              }))
        }
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          if (picker === "source") {
            setSource(id);
            const selected = original.sources.find((s) => s.id === id);
            setAmounts(
              Object.fromEntries(
                (selected?.allocations ?? []).map((a) => [
                  a.voucherId,
                  (a.amount / 100).toFixed(2),
                ]),
              ),
            );
          } else setLedger(id);
          setConfirmed(false);
          setPicker(null);
        }}
      />
    </View>
  );
}
