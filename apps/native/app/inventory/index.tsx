import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { formatINR, today } from "@repo/core";
import {
  Button,
  DateField,
  EmptyState,
  Header,
  ListRow,
  PagedView,
  Screen,
  TextField,
  Txt,
  showError,
} from "@/components";
import {
  useInventoryAccess,
  useInventoryAdjustmentPages,
  useInventoryReverse,
} from "@/data/inventoryHooks";
import { space } from "@/theme";

export default function InventoryCorrections() {
  const access = useInventoryAccess();
  const query = useInventoryAdjustmentPages();
  const reverse = useInventoryReverse();
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  async function save() {
    try {
      const saved = await reverse.mutateAsync({ id: selected, date, reason });
      setSelected("");
      router.push(`/voucher/${saved.id}`);
    } catch (error) {
      showError("Could not reverse adjustment", error);
    }
  }
  return (
    <Screen
      header={<Header title="Inventory adjustments" />}
      onEndReached={query.loadMore}
    >
      {!access.read || !access.connected ? (
        <EmptyState title="Sign in to view inventory adjustments" />
      ) : (
        <>
          {access.write ? (
            <Button
              label="New adjustment"
              icon="plus"
              onPress={() => router.push("/inventory/new")}
            />
          ) : null}
          <PagedView list={query} noun="adjustments">
            {({ items: rows }) => (
              <View style={{ gap: space.md }}>
                {!rows.length ? (
                  <EmptyState title="No stock adjustments" />
                ) : null}
                {rows.map((row) => (
                  <View key={row.id} style={{ gap: space.sm }}>
                    <ListRow
                      title={row.number}
                      subtitle={`${row.date} | ${row.inventoryAdjustment?.kind} | ${row.inventoryAdjustment?.reason}`}
                      right={<Txt>{formatINR(row.amount)}</Txt>}
                      onPress={() => router.push(`/voucher/${row.id}`)}
                    />
                    {access.write &&
                    row.inventoryAdjustment?.kind !== "reversal" &&
                    !rows.some(
                      (other) =>
                        other.inventoryAdjustment?.reversesId === row.id,
                    ) ? (
                      <Button
                        label="Reverse"
                        icon="rotate-ccw"
                        onPress={() => {
                          setSelected(row.id);
                          setReason("");
                        }}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </PagedView>
          {selected ? (
            <View style={{ gap: space.md }}>
              <Txt variant="heading">Reverse adjustment</Txt>
              <DateField value={date} onChange={setDate} />
              <TextField
                label="Reversal reason"
                value={reason}
                onChangeText={setReason}
                maxLength={300}
              />
              <Button
                label="Post reversal"
                icon="check"
                variant="primary"
                disabled={!reason.trim()}
                loading={reverse.isPending}
                onPress={save}
              />
              <Button label="Cancel" icon="x" onPress={() => setSelected("")} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
