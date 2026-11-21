import { useEffect, useState } from "react";
import { View } from "react-native";
import { can, type OverdueSalesPolicy } from "@repo/core";
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Header,
  QueryView,
  Screen,
  Txt,
  showError,
} from "@/components";
import { useSalesControls, useSaveSalesControls } from "@/data/queries";
import { useData } from "@/data/DataProvider";
import { space } from "@/theme";

const POLICIES: { value: OverdueSalesPolicy; label: string; note: string }[] = [
  {
    value: "off",
    label: "Allow",
    note: "Overdue bills are not mentioned on the sale form.",
  },
  {
    value: "warn",
    label: "Warn",
    note: "The sale form shows the overdue amount; the sale can still be saved.",
  },
  {
    value: "block",
    label: "Block",
    note: "A new sale to a customer with overdue bills needs the owner's approval, like a sale above the credit limit. Editing an existing sale is not blocked.",
  },
];

/** Credit control (doc 37, T11): what overdue bills do to a new sale. */
export default function CreditControlScreen() {
  const saved = useSalesControls();
  return (
    <Screen
      header={
        <Header title="Credit control" subtitle="Overdue bills and new sales" />
      }
    >
      <QueryView query={saved}>{(s) => <Policy saved={s} />}</QueryView>
    </Screen>
  );
}

function Policy({
  saved,
}: {
  saved: { overdueSales: OverdueSalesPolicy; version: number };
}) {
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const save = useSaveSalesControls();
  const [policy, setPolicy] = useState(saved.overdueSales);
  useEffect(() => setPolicy(saved.overdueSales), [saved.overdueSales]);
  const chosen = POLICIES.find((p) => p.value === policy)!;
  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <View style={{ gap: space.md }}>
          <Txt variant="heading">When a customer has overdue bills</Txt>
          <ChipRow>
            {POLICIES.map((p) => (
              <Chip
                key={p.value}
                label={p.label}
                selected={policy === p.value}
                onPress={canEdit ? () => setPolicy(p.value) : undefined}
              />
            ))}
          </ChipRow>
          <Txt tone="body">{chosen.note}</Txt>
        </View>
      </Card>
      <Txt variant="small" tone="body">
        A bill is overdue once its credit days (set on each customer) have
        passed. Each customer&apos;s credit limit always needs the owner&apos;s
        approval to exceed.
      </Txt>
      {canEdit ? (
        <Button
          label="Save"
          icon="check"
          variant="primary"
          block
          disabled={policy === saved.overdueSales}
          loading={save.isPending}
          onPress={async () => {
            try {
              await save.mutateAsync({
                overdueSales: policy,
                version: saved.version,
              });
            } catch (e) {
              showError("Couldn't save", e);
            }
          }}
        />
      ) : null}
    </View>
  );
}
