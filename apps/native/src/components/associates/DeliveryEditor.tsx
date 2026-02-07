import { useState } from "react";
import { View } from "react-native";
import { today } from "@repo/core";
import type { DeliveryAssignment } from "@repo/contracts/src/associates";
import {
  Button,
  DateField,
  PickerSheet,
  SelectField,
  TextField,
  showError,
} from "@/components";
import { useAssociateDelivery } from "@/data/associateHooks";
import { space } from "@/theme";

export function DeliveryEditor({
  assignment,
  done,
}: {
  assignment: DeliveryAssignment;
  done: () => void;
}) {
  const [original] = useState(assignment);
  const [status, setStatus] = useState(original.status);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [picker, setPicker] = useState(false);
  const mutation = useAssociateDelivery();
  const save = async () => {
    try {
      await mutation.mutateAsync({
        id: original.id,
        version: original.version,
        data: { status, date, note },
      });
      done();
    } catch (error) {
      showError("Couldn't update delivery", error);
    }
  };
  return (
    <View style={{ gap: space.md }}>
      <SelectField
        label="Delivery status"
        value={status}
        onPress={() => setPicker(true)}
      />
      <DateField label="Status date" value={date} onChange={setDate} />
      <TextField
        label="Delivery note"
        value={note}
        onChangeText={setNote}
        maxLength={500}
      />
      <Button
        label="Save status"
        icon="check"
        variant="primary"
        loading={mutation.isPending}
        onPress={save}
      />
      <Button label="Cancel" icon="x" onPress={done} />
      <PickerSheet
        visible={picker}
        title="Delivery status"
        options={[
          "assigned",
          "dispatched",
          "delivered",
          "failed",
          "returned",
        ].map((id) => ({ id, title: id }))}
        onSelect={(id) => {
          setStatus(id as DeliveryAssignment["status"]);
          setPicker(false);
        }}
        onClose={() => setPicker(false)}
      />
    </View>
  );
}
