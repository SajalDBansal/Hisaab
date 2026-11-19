import { useEffect, useState } from "react";
import { View } from "react-native";
import { can, type OverdueSalesPolicy, type StockPolicy } from "@repo/core";
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

const POLICIES: { value: StockPolicy; label: string; note: string }[] = [
  {
    value: "warn",
    label: "Warn",
    note: "The sale form warns when a line leaves less than the item's minimum stock; the sale can still be saved.",
  },
  {
    value: "block",
    label: "Block",
    note: "A new sale that leaves an item below its minimum stock is refused. Editing an existing sale is not blocked.",
  },
];

/** Stock control (doc 37, T37): what the minimum stock level does to a new sale. */
export default function StockControlScreen() {
  const saved = useSalesControls();
  return (
    <Screen
      header={
        <Header title="Stock control" subtitle="Minimum stock and new sales" />
      }
    >
      <QueryView query={saved}>{(s) => <Policy saved={s} />}</QueryView>
    </Screen>
  );
}

function Policy({
  saved,
}: {
  saved: {
    overdueSales: OverdueSalesPolicy;
    stockPolicy?: StockPolicy;
    version: number;
  };
}) {
  const { role } = useData();
  const canEdit = !!role && can(role, "settings");
  const save = useSaveSalesControls();
  const current = saved.stockPolicy ?? "warn";
  const [policy, setPolicy] = useState(current);
  useEffect(() => setPolicy(current), [current]);
  const chosen = POLICIES.find((p) => p.value === policy)!;
  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <View style={{ gap: space.md }}>
          <Txt variant="heading">When a sale goes below the minimum</Txt>
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
        Stock never goes below zero: costs are worked out oldest purchase first
        (FIFO), so every unit sold needs a purchase or opening stock. Set each
        item&apos;s minimum and maximum on the item form. Services keep no
        stock.
      </Txt>
      {canEdit ? (
        <Button
          label="Save"
          icon="check"
          variant="primary"
          block
          disabled={policy === current}
          loading={save.isPending}
          onPress={async () => {
            try {
              await save.mutateAsync({
                overdueSales: saved.overdueSales,
                stockPolicy: policy,
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
