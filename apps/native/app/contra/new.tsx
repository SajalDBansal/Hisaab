import { Redirect, router } from "expo-router";
import { useState } from "react";
import { BookScopeField, useBookScope } from "@/components/BookScopeField";
import { Pressable, View } from "react-native";
import {
  allowedDates,
  can,
  amountInWords,
  checkContra,
  formatINR,
  parseRupees,
  today,
  voucherPostings,
  type LedgerWithBalance,
} from "@repo/core";
import {
  AmountField,
  Button,
  Card,
  DateField,
  FooterBar,
  Header,
  Icon,
  PostingTable,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import { useCreateContra, useLedgers, useNextNumber } from "@/data/queries";
import { colors, radius, space } from "@/theme";
import { AttachmentPicker } from "@/documents/AttachmentPicker";
import { useFinancialAttachments } from "@/documents/useFinancialAttachments";
import { useData } from "@/data/DataProvider";

/** Contra: move money between cash and bank, or between two banks. */
export default function NewContraScreen() {
  const { role } = useData();
  if (!role) return null;
  if (!can(role, "payments")) return <Redirect href="/sales" />;
  return <ContraLedgers />;
}

function ContraLedgers() {
  const ledgers = useLedgers();
  if (ledgers.data) return <Form ledgers={ledgers.data} />;
  return (
    <Screen header={<Header close title="Contra" />}>
      <QueryView query={ledgers}>{() => null}</QueryView>
    </Screen>
  );
}

function Form({ ledgers }: { ledgers: LedgerWithBalance[] }) {
  const attachments = useFinancialAttachments();
  const create = useCreateContra();
  const firstBank =
    ledgers.find((l) => l.ledger.kind === "bank")?.ledger.id ?? "";
  const [date, setDate] = useState(today());
  const [bookScope, setBookScope] = useBookScope();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState(firstBank);
  const [amountText, setAmountText] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const nextNumber = useNextNumber("contra", undefined, date);

  const amount = parseRupees(amountText) ?? 0;
  const from = ledgers.find((l) => l.ledger.id === fromId);
  const to = ledgers.find((l) => l.ledger.id === toId);
  const problem = checkContra({
    fromLedgerId: fromId,
    toLedgerId: toId,
    amount,
  });
  const goesNegative = !!from && amount > from.balance;
  const postings = voucherPostings(
    {
      id: "draft",
      type: "contra",
      number: "",
      date,
      status: "draft",
      ledgerId: fromId,
      toLedgerId: toId,
      amount,
      createdAt: "",
    },
    { ledger: from?.ledger.name, toLedger: to?.ledger.name },
  );

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
  };

  const save = async () => {
    setShowErrors(true);
    if (problem) return;
    try {
      const saved = await attachments.save(
        "/contras",
        {
          bookScope,
          date,
          fromLedgerId: fromId,
          toLedgerId: toId,
          amount,
          reference: reference.trim() || undefined,
          narration: note.trim() || undefined,
        },
        create.mutateAsync,
      );
      router.replace(`/voucher/${saved.id}`);
    } catch (e) {
      showError("Couldn't save", e);
    }
  };

  const Picker = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (id: string) => void;
  }) => (
    <View style={{ gap: space.sm }}>
      <Txt variant="label" tone="charcoal">
        {label}
      </Txt>
      {ledgers.map((l) => {
        const on = value === l.ledger.id;
        return (
          <Pressable
            key={l.ledger.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}: ${l.ledger.name}`}
            onPress={() => onChange(l.ledger.id)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              minHeight: 52,
              paddingHorizontal: 14,
              borderRadius: radius.card,
              borderWidth: on ? 2 : 1,
              borderColor: on ? colors.ink : colors.hairline,
            }}
          >
            <Icon
              name={l.ledger.kind === "cash" ? "dollar-sign" : "credit-card"}
              size={18}
            />
            <Txt variant="bodyStrong" style={{ flex: 1 }}>
              {l.ledger.name}
            </Txt>
            <Txt variant="small" tone="body" num>
              {formatINR(l.balance)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Screen
      header={
        <Header
          close
          title="Contra"
          subtitle="Move money between cash and bank"
        />
      }
      footer={
        <FooterBar>
          <View style={{ flex: 1 }}>
            <Txt variant="heading" num>
              {formatINR(amount)}
            </Txt>
            <Txt
              variant="caption"
              tone={showErrors && problem ? "give" : "body"}
              numberOfLines={2}
            >
              {showErrors && problem
                ? problem
                : `${from?.ledger.name ?? "…"} → ${to?.ledger.name ?? "…"}`}
            </Txt>
          </View>
          <Button
            label="Save contra"
            variant="primary"
            onPress={save}
            loading={create.isPending || attachments.busy}
          />
        </FooterBar>
      }
    >
      <View style={{ flexDirection: "row", gap: space.md }}>
        <TextField
          label="Contra no."
          value={nextNumber.data ?? "…"}
          editable={false}
          mono
        />
        <DateField
          value={date}
          onChange={setDate}
          min={allowedDates().min}
          max={allowedDates().max}
        />
      </View>

      <Picker label="Money from" value={fromId} onChange={setFromId} />
      <View style={{ alignItems: "center" }}>
        <Button label="Swap" icon="repeat" size="sm" onPress={swap} />
      </View>
      <Picker label="Money to" value={toId} onChange={setToId} />

      <Card variant="soft" style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row" }}>
          <AmountField
            label="Amount ₹"
            value={amountText}
            onChangeText={setAmountText}
          />
        </View>
        <Txt variant="caption" tone="body" center>
          {amountInWords(amount)}
        </Txt>
        {goesNegative ? (
          <Txt variant="caption" tone="warn" center>
            {from?.ledger.name} has only {formatINR(from?.balance ?? 0)}. You
            can still save.
          </Txt>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row" }}>
        <TextField
          label="Reference (optional)"
          value={reference}
          onChangeText={setReference}
          placeholder="e.g. Deposit slip no., cheque no."
        />
      </View>
      <TextField
        label="Note (optional)"
        value={note}
        onChangeText={setNote}
        multiline
      />

      <AttachmentPicker {...attachments} />
      <BookScopeField value={bookScope} onChange={setBookScope} />
      {amount > 0 && !problem ? <PostingTable rows={postings} /> : null}
    </Screen>
  );
}
