import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatDate, formatINR, today } from "@repo/core";
import type { SettlementRecord } from "@repo/contracts/src/settlements";
import {
  Button,
  Checkbox,
  DateField,
  EmptyState,
  Header,
  QueryView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useReverseSettlement,
  useSettlement,
  useSettlementAccess,
} from "@/data/settlementHooks";
import { space } from "@/theme";

export default function SettlementDetail() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const query = useSettlement(id),
    access = useSettlementAccess();
  return (
    <Screen header={<Header title="Settlement" />}>
      {!access.read || !access.connected ? (
        <EmptyState title="Settlement unavailable" />
      ) : (
        <QueryView query={query}>
          {(entry) => <Detail entry={entry} />}
        </QueryView>
      )}
    </Screen>
  );
}
function Detail({ entry }: { entry: SettlementRecord }) {
  const access = useSettlementAccess(),
    reverse = useReverseSettlement(entry.id);
  const [date, setDate] = useState(today()),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const submit = async () => {
    if (!confirmed || reverse.isPending || reason.trim().length < 3) return;
    try {
      const saved = await reverse.mutateAsync({
        date,
        reason,
        bookScope: entry.bookScope,
        version: entry.version,
      });
      router.replace(`/settlements/${saved.id}`);
    } catch (error) {
      showError("Couldn't reverse settlement", error);
    }
  };
  return (
    <View style={{ gap: space.lg }}>
      <Txt variant="heading">{entry.kind.replaceAll("-", " ")}</Txt>
      <Txt>
        {formatINR(entry.amount)} | {entry.bookScope.toUpperCase()} |{" "}
        {formatDate(entry.date)}
      </Txt>
      <Txt>{entry.reason}</Txt>
      <Txt variant="caption">
        {entry.userName} | {formatDate(entry.createdAt.slice(0, 10))}
      </Txt>
      <Button
        label="Journal"
        icon="external-link"
        onPress={() => router.push(`/voucher/${entry.voucherId}`)}
      />
      {entry.sourceVoucherId ? (
        <Button
          label="Original entry"
          icon="link"
          onPress={() => router.push(`/voucher/${entry.sourceVoucherId}`)}
        />
      ) : null}
      {entry.loanId ? (
        <Button
          label="Loan register"
          icon="briefcase"
          onPress={() => router.push(`/loans/${entry.loanId}`)}
        />
      ) : null}
      {access.owner &&
      !["reversal", "allocation-correction"].includes(entry.kind) ? (
        <>
          <DateField
            label="Reversal date"
            value={date}
            onChange={setDate}
            min={entry.date}
            max={today()}
          />
          <TextField
            label="Reversal reason"
            value={reason}
            onChangeText={setReason}
            maxLength={500}
          />
          <Checkbox
            label="Post a separate reversing journal"
            checked={confirmed}
            onChange={setConfirmed}
          />
          <Button
            label="Reverse settlement"
            icon="rotate-ccw"
            disabled={!confirmed || reason.trim().length < 3}
            loading={reverse.isPending}
            onPress={submit}
          />
        </>
      ) : null}
    </View>
  );
}
