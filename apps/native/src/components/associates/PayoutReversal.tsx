import { useState } from "react";
import { View } from "react-native";
import { today } from "@repo/core";
import type { AssociatePayout } from "@repo/contracts/src/associates";
import { Button, DateField, TextField, showError } from "@/components";
import { useReverseAssociatePayout } from "@/data/associateHooks";
import { space } from "@/theme";

export function PayoutReversal({
  payout,
  done,
}: {
  payout: AssociatePayout;
  done: () => void;
}) {
  const [original] = useState(payout);
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const mutation = useReverseAssociatePayout();
  const save = async () => {
    try {
      await mutation.mutateAsync({
        id: original.id,
        version: original.version,
        data: { date, reason },
      });
      done();
    } catch (error) {
      showError("Couldn't reverse payout", error);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <DateField label="Reversal date" value={date} onChange={setDate} />
      <TextField
        label="Reason for reversal"
        value={reason}
        onChangeText={setReason}
        maxLength={500}
      />
      <Button
        label="Record payout reversal"
        icon="rotate-ccw"
        variant="primary"
        disabled={!reason.trim()}
        loading={mutation.isPending}
        onPress={save}
      />
      <Button label="Cancel" icon="x" onPress={done} />
    </View>
  );
}
