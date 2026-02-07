import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, parseRupees, today } from "@repo/core";
import {
  AssociatePayoutInput,
  type AssociateDetail,
  type AssociateStatement,
} from "@repo/contracts/src/associates";
import {
  AmountField,
  Button,
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
import { AssociateGate } from "@/components/associates/AssociateGate";
import {
  useAssociate,
  useAssociatePayout,
  useAssociateStatement,
} from "@/data/associateHooks";
import { useLedgers } from "@/data/queries";
import { space } from "@/theme";

export default function Payout() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const detail = useAssociate(id);
  const statement = useAssociateStatement(id, {
    scope: "all",
    unpaidOnly: "true",
  });
  return (
    <Screen header={<Header close title="Record commission payout" />}>
      <AssociateGate>
        <QueryView query={detail}>
          {(profile) => (
            <QueryView query={statement}>
              {(entries) => (
                <PayoutForm
                  key={profile.associate.id}
                  detail={profile}
                  statement={entries}
                />
              )}
            </QueryView>
          )}
        </QueryView>
      </AssociateGate>
    </Screen>
  );
}
function PayoutForm({
  detail,
  statement,
}: {
  detail: AssociateDetail;
  statement: AssociateStatement;
}) {
  const [original] = useState({ detail, statement });
  const [date, setDate] = useState(today());
  const [ledgerId, setLedgerId] = useState("");
  const [reference, setReference] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState(false);
  const ledgers = useLedgers();
  const mutation = useAssociatePayout(detail.associate.id);
  const parsed = AssociatePayoutInput.safeParse({
    date,
    ledgerId,
    reference,
    allocations: Object.entries(amounts)
      .filter(([, value]) => !!value && parseRupees(value) !== 0)
      .map(([accrualId, value]) => ({ accrualId, amount: parseRupees(value) })),
  });
  const total = parsed.success
    ? parsed.data.allocations.reduce((s, a) => s + a.amount, 0)
    : 0;
  const overpaid =
    parsed.success &&
    (total > original.statement.closing ||
      parsed.data.allocations.some(
        (a) =>
          a.amount >
          (original.statement.accruals.find((r) => r.id === a.accrualId)
            ?.balance ?? 0),
      ));
  const save = async () => {
    if (!parsed.success || mutation.isPending) return;
    try {
      await mutation.mutateAsync({
        data: parsed.data,
        version: original.detail.associate.version,
      });
      router.replace(`/associates/${detail.associate.id}`);
    } catch (error) {
      showError("Couldn't record payout", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="bodyStrong">
        {detail.associate.name} | Due {formatINR(original.statement.closing)}
      </Txt>
      <DateField label="Payout date" value={date} onChange={setDate} />
      <SelectField
        label="Cash / bank account"
        value={ledgers.data?.find((l) => l.ledger.id === ledgerId)?.ledger.name}
        onPress={() => setPicker(true)}
      />
      <TextField
        label="Payment reference"
        value={reference}
        onChangeText={setReference}
        maxLength={100}
      />
      {original.statement.accruals
        .filter((a) => a.balance > 0)
        .map((a) => (
          <View key={a.id} style={{ gap: space.sm }}>
            <Txt>
              {a.date} | {a.bookScope} | Line {a.lineIndex + 1} | Due{" "}
              {formatINR(a.balance)}
            </Txt>
            <AmountField
              label="Allocate (Rs)"
              value={amounts[a.id] ?? ""}
              onChangeText={(value) =>
                setAmounts((current) => ({ ...current, [a.id]: value }))
              }
            />
            <Button
              label="Allocate full balance"
              icon="check"
              onPress={() =>
                setAmounts((current) => ({
                  ...current,
                  [a.id]: (a.balance / 100).toFixed(2),
                }))
              }
            />
          </View>
        ))}
      <Txt variant="bodyStrong">Payout {formatINR(total)}</Txt>
      {original.statement.difference ? (
        <Txt tone="give">
          Ledger difference {formatINR(original.statement.difference)}
        </Txt>
      ) : null}
      {overpaid ? (
        <Txt tone="give">Payout exceeds unpaid commission.</Txt>
      ) : null}
      {!parsed.success ? (
        <Txt tone="give">{parsed.error.issues[0]?.message}</Txt>
      ) : null}
      <Button
        label="Record payout"
        icon="check"
        variant="primary"
        loading={mutation.isPending}
        disabled={
          !parsed.success || overpaid || !!original.statement.difference
        }
        onPress={save}
      />
      <PickerSheet
        visible={picker}
        title="Cash / bank account"
        options={(ledgers.data ?? []).map(({ ledger: l }) => ({
          id: l.id,
          title: l.name,
          subtitle: l.kind,
        }))}
        onSelect={(id) => {
          setLedgerId(id);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}
